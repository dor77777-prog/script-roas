// dashboard-web/src/lib/inngest/__tests__/freshness.test.ts
//
// TDD tests for freshness.ts helpers:
//   - recordFreshness: read-then-upsert per (store_id, platform, scope, table_name)
//   - getFreshness: read all rows (or filter by scope), sorted by lag_minutes DESC NULLS LAST

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordFreshness, getFreshness } from '../freshness';
import { captureStepError } from '@/lib/sentry/capture';

// Sentry capture is mocked so we can assert that DB-layer errors are SURFACED
// (#11) rather than resolving silently. The helper is a no-op spy here.
vi.mock('@/lib/sentry/capture', () => ({
  captureStepError: vi.fn(),
}));

// --- Fake timers & epoch constant ------------------------------------------

const FAKE_NOW = new Date('2026-05-29T10:00:00.000Z');
const FAKE_NOW_ISO = FAKE_NOW.toISOString();

// --- Mocks ------------------------------------------------------------------

// Captures for the write path (upsert)
const upsertMock = vi.fn();

// What maybeSingle returns — tests override this per-case
const maybeSingleMock = vi.fn();

// What the terminal .order() resolves to — tests override per-case
const orderResultMock = vi.fn();

// Track .eq() calls made on the getFreshness chain (scope filtering)
const selectEqCallArgs: Array<[string, unknown]> = [];

/**
 * Mock structure:
 *
 * recordFreshness read path:
 *   from('data_freshness').select('*')
 *     .eq('store_id', …).eq('platform', …).eq('scope', …).eq('table_name', …)
 *     .maybeSingle()
 *
 * getFreshness path (both scoped + unscoped):
 *   from('data_freshness').select('*')
 *     [.eq('scope', scope)]  ← only when scope provided
 *     .order('lag_minutes', { ascending: false, nullsFirst: false })
 *
 * We distinguish them by counting how many .eq() chained calls occur before
 * a terminal method (.maybeSingle vs .order).  We build a unified chain object
 * that tracks depth; after 4 .eq() calls the chain exposes .maybeSingle (recordFreshness
 * read path); after 0–1 .eq() calls the chain exposes .order (getFreshness path).
 */

function makeChain(depth = 0): Record<string, unknown> {
  return {
    eq: (field: string, value: unknown) => {
      if (depth === 0) {
        // Could be getFreshness scope filter (depth 0 → 1) or start of
        // recordFreshness 4-deep chain. We record the call for assertion.
        selectEqCallArgs.push([field, value]);
      }
      return makeChain(depth + 1);
    },
    maybeSingle: depth >= 3 ? maybeSingleMock : undefined,
    order: orderResultMock,
  };
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols?: string) => makeChain(0),
      upsert: upsertMock,
    }),
  }),
}));

// --- Helper factories -------------------------------------------------------

function makeExistingRow(overrides: Partial<{
  last_success_at: string | null;
  status: string;
}> = {}): Record<string, unknown> {
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'kpi_daily',
    table_name: 'data_daily',
    last_attempt_at: '2026-05-29T09:00:00.000Z',
    last_success_at: '2026-05-29T09:30:00.000Z',
    status: 'success',
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: '2026-05-29T09:00:00.000Z',
    ...overrides,
  };
}

const BASE_OPTS = {
  storeId: 'uzoshop' as const,
  platform: 'meta' as const,
  scope: 'kpi_daily',
  tableName: 'data_daily',
} as const;

// --- Setup / Teardown -------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);

  selectEqCallArgs.length = 0;

  vi.mocked(captureStepError).mockClear();

  // Default: no existing row
  maybeSingleMock.mockReset().mockResolvedValue({ data: null, error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  orderResultMock.mockReset().mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe('freshness', () => {
  // ---------------------------------------------------------------------------
  // recordFreshness
  // ---------------------------------------------------------------------------

  describe('recordFreshness', () => {
    it('success — last_success_at = now, lag_minutes = 0, no error fields', async () => {
      await recordFreshness({ ...BASE_OPTS, status: 'success' });

      expect(upsertMock).toHaveBeenCalledOnce();
      const [payload, opts] = upsertMock.mock.calls[0];

      expect(payload.last_attempt_at).toBe(FAKE_NOW_ISO);
      expect(payload.last_success_at).toBe(FAKE_NOW_ISO);
      expect(payload.lag_minutes).toBe(0);
      expect(payload.error_code).toBeNull();
      expect(payload.error_message).toBeNull();
      expect(payload.updated_at).toBe(FAKE_NOW_ISO);
      expect(opts).toEqual({ onConflict: 'store_id,platform,scope,table_name' });
    });

    it('failure with prior success — lag_minutes computed from (now - prior last_success_at)', async () => {
      // Prior success was 30 minutes before FAKE_NOW (10:00) → 09:30
      const priorSuccessAt = '2026-05-29T09:30:00.000Z';
      maybeSingleMock.mockResolvedValue({
        data: makeExistingRow({ last_success_at: priorSuccessAt }),
        error: null,
      });

      await recordFreshness({ ...BASE_OPTS, status: 'transient_error', errorCode: '429' });

      const [payload] = upsertMock.mock.calls[0];
      // FAKE_NOW (10:00) - priorSuccessAt (09:30) = 30 minutes
      expect(payload.lag_minutes).toBe(30);
      // last_success_at preserved from prior row
      expect(payload.last_success_at).toBe(priorSuccessAt);
    });

    it('failure with NO prior success — lag_minutes is null', async () => {
      maybeSingleMock.mockResolvedValue({ data: null, error: null });

      await recordFreshness({ ...BASE_OPTS, status: 'parse_error', errorCode: 'PARSE_FAIL' });

      const [payload] = upsertMock.mock.calls[0];
      expect(payload.lag_minutes).toBeNull();
      expect(payload.last_success_at).toBeNull();
    });

    it('budget_skip status — budget_skip=true by default from status', async () => {
      await recordFreshness({ ...BASE_OPTS, status: 'budget_skip' });

      const [payload] = upsertMock.mock.calls[0];
      expect(payload.budget_skip).toBe(true);
    });

    it('errorMessage longer than 500 chars — truncated to exactly 500 chars', async () => {
      const longMsg = 'x'.repeat(600);
      await recordFreshness({ ...BASE_OPTS, status: 'transient_error', errorMessage: longMsg });

      const [payload] = upsertMock.mock.calls[0];
      expect(payload.error_message).toHaveLength(500);
    });

    it('uses the right composite PK in onConflict', async () => {
      await recordFreshness({ ...BASE_OPTS, status: 'success' });

      const [, opts] = upsertMock.mock.calls[0];
      expect(opts.onConflict).toBe('store_id,platform,scope,table_name');
    });

    it('swallows Supabase upsert REJECTION — no throw, console.warn called', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      upsertMock.mockRejectedValue(new Error('db unavailable'));

      await expect(
        recordFreshness({ ...BASE_OPTS, status: 'success' }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        '[recordFreshness] upsert failed:',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    // -- FIX A (#11): supabase-js resolves (does NOT reject) on DB-layer
    //    errors. The non-rejecting `{ error }` channel must be SURFACED, not
    //    silently dropped — otherwise the very mechanism meant to expose a
    //    broken pipeline fails silently.
    it('surfaces a non-rejecting upsert error ({ error }) via console.warn + Sentry', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      upsertMock.mockResolvedValue({ error: { message: 'RLS denied' } });

      await expect(
        recordFreshness({ ...BASE_OPTS, status: 'success' }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[recordFreshness] upsert error'),
        'RLS denied',
      );
      expect(captureStepError).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    // -- FIX A (#18): on a NON-success tick whose prior-row READ errored, we
    //    must NOT write — otherwise lastSuccessAt resolves to null and clobbers
    //    a known-good last_success_at, flipping a healthy scope to
    //    "never succeeded".
    it('non-success tick whose prior-row READ errored → SKIPS the write (no clobber)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'read blip' } });

      await recordFreshness({ ...BASE_OPTS, status: 'transient_error', errorCode: '429' });

      expect(upsertMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[recordFreshness] prior-row read error'),
        'read blip',
      );
      expect(captureStepError).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    // A success tick whose read errored is still safe to write (lastSuccessAt
    // = now, not derived from the prior row), so it should NOT be skipped.
    it('success tick whose prior-row READ errored → still writes (last_success_at = now)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'read blip' } });

      await recordFreshness({ ...BASE_OPTS, status: 'success' });

      expect(upsertMock).toHaveBeenCalledOnce();
      const [payload] = upsertMock.mock.calls[0];
      expect(payload.last_success_at).toBe(FAKE_NOW_ISO);
      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // getFreshness
  // ---------------------------------------------------------------------------

  describe('getFreshness', () => {
    it('with no scope arg — calls .order() and returns all rows', async () => {
      const rows = [
        makeExistingRow({ status: 'success' }),
        makeExistingRow({ last_success_at: '2026-05-29T08:00:00.000Z', status: 'transient_error' }),
      ];
      orderResultMock.mockResolvedValue({ data: rows, error: null });

      const result = await getFreshness();

      expect(orderResultMock).toHaveBeenCalledOnce();
      expect(orderResultMock).toHaveBeenCalledWith('lag_minutes', {
        ascending: false,
        nullsFirst: false,
      });
      expect(result).toEqual(rows);
    });

    it('with scope arg — filters by scope before ordering', async () => {
      const scopedRows = [makeExistingRow()];
      orderResultMock.mockResolvedValue({ data: scopedRows, error: null });

      const result = await getFreshness('kpi_daily');

      // Should have called .eq('scope', 'kpi_daily') before .order()
      expect(selectEqCallArgs.some(([field, val]) => field === 'scope' && val === 'kpi_daily')).toBe(true);
      expect(orderResultMock).toHaveBeenCalledOnce();
      expect(result).toEqual(scopedRows);
    });

    it('returns [] on Supabase error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      orderResultMock.mockResolvedValue({ data: null, error: { message: 'connection failed' } });

      const result = await getFreshness();
      expect(result).toEqual([]);
      warnSpy.mockRestore();
    });
  });
});

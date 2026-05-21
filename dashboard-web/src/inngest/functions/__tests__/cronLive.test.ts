/**
 * Phase 05.6 Plan 09 — cron-live factory tests (TDD RED gate).
 *
 * cron-live mirrors Apps Script's 15-minute live trigger which refreshes
 * Shopify revenue for a rolling 3-day window. Meta + Google Ads spend
 * insights are NOT refreshed on the live cadence — they're owned by the
 * daily cron (plan 08). Skipping them on live keeps execution count under
 * the Inngest free-tier 50K/month budget (per 05.6-RESEARCH.md §Pitfall 4
 * recommended decomposition: 2 step.run + 1 function = 3 execs/run).
 *
 * What this file covers (6 tests):
 *   1. cronLiveFunctions.length === 3            — one per store
 *   2. Each function has unique id "cron-live-{storeId}"
 *   3. Each function has cron trigger "TZ=Asia/Jerusalem *\/15 * * * *"
 *   4. runLiveForStore fetches Shopify for TODAY and 2 prior days
 *      (rolling 3-day window) and persists each day's row.
 *   5. Meta + Google fetchers are NEVER called (Shopify-only on live).
 *   6. An error thrown from any step.run propagates out of the handler.
 *
 * Refs:
 *   - 05.6-09-PLAN.md §<tasks> Task 1
 *   - 05.6-RESEARCH.md §Pattern 2 (factory across stores, lines 381-492)
 *   - 05.6-RESEARCH.md §Pitfall 4 (step decomposition, lines 1395-1419)
 *   - 05.6-PATTERNS.md S-9 §cronLive.ts (conventions, line 521-528)
 *
 * NOTE: this file lives under `src/inngest/functions/__tests__/`. The
 * project-wide `vitest.config.ts` include glob is
 * `src/lib/**\/__tests__/**\/*.test.{ts,tsx}` which does NOT pick up
 * `src/inngest/**`. Run explicitly via:
 *
 *   npx vitest run src/inngest/functions/__tests__/cronLive.test.ts
 *
 * The plan's `<verify>` block invokes exactly that path. Widening the glob
 * is a vitest-config change that can be done in a separate plan to avoid
 * cross-wave conflicts with plan 08 (cronDaily) which also lives here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
import * as googleAdsFetcher from '@/lib/fetchers/googleAds';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `step` stub matching Inngest's `step.run(label, fn)` shape.
 * Each call invokes `fn` once and records the label so tests can assert
 * the step decomposition (Pitfall 4 budget).
 *
 * Note: this stub does NOT model Inngest's retry-on-throw or memoization —
 * it's a one-shot executor. The plan tests focus on call ordering and the
 * Shopify-only invariant, not retry semantics (those are SDK-owned).
 */
function makeStepStub() {
  const labels: string[] = [];
  const step = {
    run: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      labels.push(label);
      return await fn();
    },
  };
  return { step, labels };
}

/**
 * Supabase admin client mock that records every call to .from(table).
 * The cron-live handler should ONLY touch data_daily + products_daily —
 * NEVER campaigns_daily / ads_daily / manual_overrides (those are daily-only).
 */
function makeSupabaseAdminMock() {
  const touchedTables: string[] = [];
  const upsertCalls: Array<{ table: string; rows: unknown; options?: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown; matchers: unknown }> = [];
  const selectCalls: Array<{ table: string }> = [];

  // Default "row exists" select response — overridden per-test as needed.
  let nextSelectResult: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  };
  const setNextSelectResult = (r: { data: unknown; error: unknown }) => {
    nextSelectResult = r;
  };

  function makeTableBuilder(table: string) {
    touchedTables.push(table);
    const builder = {
      upsert: vi.fn((rows: unknown, options?: unknown) => {
        upsertCalls.push({ table, rows, options });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn((payload: unknown) => {
        const chain = {
          eq: vi.fn(() => {
            const inner = {
              eq: vi.fn(() => {
                updateCalls.push({
                  table,
                  payload,
                  matchers: 'date+store_id',
                });
                return Promise.resolve({ error: null });
              }),
            };
            return inner;
          }),
        };
        return chain;
      }),
      select: vi.fn(() => {
        const chain = {
          eq: vi.fn(() => {
            const inner = {
              eq: vi.fn(() => {
                const last = {
                  maybeSingle: vi.fn(() => {
                    selectCalls.push({ table });
                    return Promise.resolve(nextSelectResult);
                  }),
                };
                return last;
              }),
            };
            return inner;
          }),
        };
        return chain;
      }),
    };
    return builder;
  }

  const admin = {
    from: vi.fn((table: string) => makeTableBuilder(table)),
  };

  return {
    admin,
    touchedTables,
    upsertCalls,
    updateCalls,
    selectCalls,
    setNextSelectResult,
  };
}

// ---------------------------------------------------------------------------
// Common test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================

describe('cronLive — factory shape', () => {
  it('Test 1: cronLiveFunctions array has exactly 3 entries (one per store)', async () => {
    const mod = await import('../cronLive');
    expect(Array.isArray(mod.cronLiveFunctions)).toBe(true);
    expect(mod.cronLiveFunctions.length).toBe(3);
  });

  it('Test 2: each function has a unique id "cron-live-{storeId}"', async () => {
    const mod = await import('../cronLive');
    const ids = mod.cronLiveFunctions.map((f) => f.id());
    expect(ids).toEqual(['cron-live-uzoshop', 'cron-live-zolplus', 'cron-live-usmile360']);
    expect(new Set(ids).size).toBe(3);
  });

  it('Test 3: each function uses cron trigger "TZ=Asia/Jerusalem */15 * * * *"', async () => {
    const mod = await import('../cronLive');
    for (const fn of mod.cronLiveFunctions) {
      // fn.opts.triggers is an array of { cron } | { event } objects per Inngest SDK v4.4.
      const triggers = (fn as unknown as { opts: { triggers: Array<{ cron?: string }> } }).opts
        .triggers;
      expect(Array.isArray(triggers)).toBe(true);
      const cronTrigger = triggers.find((t) => typeof t.cron === 'string');
      expect(cronTrigger, 'expected at least one cron trigger').toBeDefined();
      expect(cronTrigger!.cron).toBe('TZ=Asia/Jerusalem */15 * * * *');
    }
  });
});

// ===========================================================================

describe('cronLive — runLiveForStore handler (Shopify-only, rolling 3-day)', () => {
  it('Test 4: fetches Shopify for TODAY and 2 prior days (rolling 3-day window) and persists each', async () => {
    const mod = await import('../cronLive');

    // Mock Shopify fetcher — returns deterministic shape, tracks call args.
    const shopifySpy = vi
      .spyOn(shopifyFetcher, 'fetchShopifyDayRows')
      .mockImplementation(async (storeId, date) => ({
        storeId,
        date,
        storeName: 'uzoshop',
        revenueCad: 1000,
        productRows: [{ product_id: 'p1', net_revenue_cad: 500 }],
        customItemRefundCad: 0,
      }));

    const { admin, upsertCalls, updateCalls, selectCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step, labels } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // Shopify fetcher should be called exactly 3 times (today + 2 prior days).
    expect(shopifySpy).toHaveBeenCalledTimes(3);

    // Dates must be in 'YYYY-MM-DD' format and form a 3-day rolling window
    // (today, today-1, today-2 in Asia/Jerusalem). Order-agnostic equality
    // — implementation may sort newest-first OR oldest-first.
    const dateArgs = shopifySpy.mock.calls.map((c) => c[1]);
    expect(dateArgs.length).toBe(3);
    for (const d of dateArgs) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(d)).toBe(true);
    }
    // The 3 dates must be unique.
    expect(new Set(dateArgs).size).toBe(3);

    // Verify the 3-day rolling window: the 3 dates must be consecutive
    // calendar days (we don't pin the exact day because that depends on
    // "now" in Asia/Jerusalem at test-run time).
    const sorted = [...dateArgs].sort();
    const d0 = new Date(`${sorted[0]}T00:00:00Z`).getTime();
    const d1 = new Date(`${sorted[1]}T00:00:00Z`).getTime();
    const d2 = new Date(`${sorted[2]}T00:00:00Z`).getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    expect(d1 - d0).toBe(ONE_DAY);
    expect(d2 - d1).toBe(ONE_DAY);

    // Persist step must have been called — at least 1 SELECT and 1 UPSERT
    // (insert or update path) per date. The exact counts depend on whether
    // the implementation chose SELECT-then-UPDATE or pure UPSERT, but the
    // touch set must include 'data_daily' and 'products_daily' for each
    // rolling-window date.
    const dataTouches = [...upsertCalls, ...updateCalls, ...selectCalls].filter(
      (c) => c.table === 'data_daily',
    ).length;
    expect(dataTouches).toBeGreaterThanOrEqual(3);

    // Step labels must match Pitfall 4 recommendation: ≤3 step.runs.
    // Allow 2 or 3 (fetch + persist, or fetch + per-date persist if split).
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.length).toBeLessThanOrEqual(3);
  });

  it('Test 5: Meta + Google Ads fetchers are NEVER called by the live handler', async () => {
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(async (storeId, date) => ({
      storeId,
      date,
      storeName: 'uzoshop',
      revenueCad: 0,
      productRows: [],
      customItemRefundCad: 0,
    }));

    const metaSpy = vi
      .spyOn(metaFetcher, 'fetchMetaSpendForDay')
      .mockResolvedValue({ spend: 0, currency: 'ILS' });
    const googleSpy = vi
      .spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay')
      .mockResolvedValue({ spend: 0, currency: 'CAD' });

    const { admin } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // The whole point of the live cadence: it must NEVER hit Meta or Google.
    // Daily cron owns spend reconciliation; live owns revenue only.
    expect(metaSpy).not.toHaveBeenCalled();
    expect(googleSpy).not.toHaveBeenCalled();
  });

  it('Test 6: an error thrown from a step.run callback propagates out of the handler', async () => {
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockRejectedValue(
      new Error('Shopify 503 — service unavailable'),
    );

    const { admin } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await expect(mod.runLiveForStore('uzoshop', { step })).rejects.toThrow(
      /Shopify 503|service unavailable/i,
    );
  });
});

// dashboard-web/src/lib/__tests__/operatorHealthSummary.test.ts
//
// Task 5.1 (UI/UX overhaul) — unit tests for the /api/operator/health-summary
// route's GREEN/YELLOW/RED threshold logic. The route imports getFreshness
// and the supabase admin client; we mock both so we can drive the freshness
// vector + token_failures count and assert the derived status.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FreshnessRow } from '@/lib/inngest/freshness';

// ---------------------------------------------------------------------------
// Mocks — hoisted before importing the route.
// ---------------------------------------------------------------------------
let nextRows: FreshnessRow[] = [];
let nextCount: number | null = 0;

vi.mock('@/lib/inngest/freshness', () => ({
  getFreshness: async () => nextRows,
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        is: async () => ({ count: nextCount, error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/sentry/capture', () => ({
  captureRouteError: vi.fn(),
}));

import { GET } from '@/app/api/operator/health-summary/route';

function makeRow(status: string): FreshnessRow {
  const now = new Date().toISOString();
  return {
    store_id: 'uzoshop',
    platform: 'meta',
    scope: 'campaign_status',
    table_name: 'campaigns_daily',
    last_attempt_at: now,
    last_success_at: now,
    status,
    lag_minutes: 0,
    error_code: null,
    error_message: null,
    budget_skip: false,
    updated_at: now,
  };
}

describe('/api/operator/health-summary — status thresholds', () => {
  beforeEach(() => {
    nextRows = [];
    nextCount = 0;
  });

  it('GREEN when freshness === 100% AND errors_1h === 0', async () => {
    nextRows = [makeRow('success'), makeRow('success'), makeRow('success')];
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('green');
    expect(body.freshness_pct).toBe(1);
    expect(body.errors_1h).toBe(0);
  });

  it('GREEN at exact threshold (freshness === 95% AND 0 errors)', async () => {
    // 19/20 = 0.95
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(i < 19 ? 'success' : 'transient_error'),
    );
    nextRows = rows;
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('green');
  });

  it('YELLOW when 1 errors_1h and freshness still ≥80%', async () => {
    nextRows = [makeRow('success'), makeRow('success'), makeRow('success'), makeRow('success'), makeRow('success')];
    nextCount = 1;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('yellow');
  });

  it('YELLOW when freshness in [80, 95)', async () => {
    // 17/20 = 0.85
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(i < 17 ? 'success' : 'transient_error'),
    );
    nextRows = rows;
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('yellow');
  });

  it('RED when freshness < 80%', async () => {
    // 15/20 = 0.75
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow(i < 15 ? 'success' : 'transient_error'),
    );
    nextRows = rows;
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('red');
  });

  it('RED when errors_1h > 3', async () => {
    nextRows = [makeRow('success'), makeRow('success'), makeRow('success'), makeRow('success'), makeRow('success')];
    nextCount = 4;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('red');
  });

  it('GREEN when data_freshness is empty (cold start, nothing wrong yet)', async () => {
    nextRows = [];
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe('green');
    expect(body.freshness_pct).toBe(1);
  });

  it('returns lastUpdated as an ISO string', async () => {
    nextRows = [];
    nextCount = 0;
    const res = await GET();
    const body = await res.json();
    expect(typeof body.lastUpdated).toBe('string');
    expect(Number.isNaN(new Date(body.lastUpdated).getTime())).toBe(false);
  });
});

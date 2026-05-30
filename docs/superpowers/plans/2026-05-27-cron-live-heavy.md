# Live per-campaign metrics (cron-live-heavy) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `campaigns_daily` (per campaign+adset metrics) and `ads_daily` (per-ad metrics) every 30 minutes during the day, for today + yesterday, so the Campaigns tab and Ads drawer surface live numbers instead of empty rows until tomorrow's 01:00 nightly run.

**Architecture:** Add a NEW Inngest function `cron-live-heavy-{store}` that runs every 30 min on `TZ=Asia/Jerusalem`. It re-uses the existing per-campaign / per-ad / per-adset light-weight fetchers from `@/lib/fetchers/{meta,googleAds,tiktok}.ts` (already shared with cron-daily) and writes to `campaigns_daily` + `ads_daily` via a new dedicated persist helper. cron-daily and cron-live are **NOT modified** — the new function lives alongside them and its UPSERTs cooperate via `ON CONFLICT DO UPDATE` (the later writer wins per column; both writers produce identical shapes). Rate-limit (HTTP 429) failures soft-fail the current tick, fire a throttled WhatsApp alert via `notifyTokenFailure`, and let the next tick retry.

**Tech Stack:**
- Inngest SDK v4 (`createFunction` with cron trigger)
- Supabase JS (admin client for service-role UPSERTs)
- `fetchMetaAdSetInsights` / `fetchMetaAdInsights` / `fetchMetaBudgets` / `fetchGoogleAdsAdGroupInsights` / `fetchGoogleAdsAdInsights` / `fetchTikTokAdInsights` from `@/lib/fetchers`
- `getFxRate` + an inline `cadFor` closure (FX conversion, same pattern as cron-daily)
- `notifyTokenFailure` for rate-limit + auth alerts
- `withTimeout` wrapper from cron-live for per-fetch timeouts
- Vitest for the new test file

---

## Pre-flight: Scope decisions locked from the brainstorming

1. **What to write live**: `spend_cad`, `impressions`, `clicks`, `conversions`, `conversion_value_cad`, `effective_status`, budget columns on `campaigns_daily`. Plus full `ads_daily` (per-ad spend/impressions/clicks/conversions/conversion_value_cad).
2. **Cadence**: every 30 min (`*/30 * * * *` Asia/Jerusalem cron). Chosen over 10-min to stay under Meta/Google rate limits with 6 platform×store fetches × ~2 dates per tick.
3. **Rolling window**: today + yesterday. Yesterday is included because late-attribution conversions (24-72h post-click) keep landing on D-1 rows.
4. **Rate-limit fallback**: on HTTP 429 from a platform, soft-fail this tick (no throw), fire one throttled WhatsApp alert per (store, platform) via the existing `notifyTokenFailure` infra, retry on next tick (30 min later).

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `dashboard-web/src/lib/notifications/detectAuthError.ts` | Modify | Add `isRateLimitError(provider, msg)` classifier (sibling of `isAuthError`). |
| `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` | Create | Pure persist helper: given fetched Meta/Google/TikTok data for one (store, date), UPSERTs `campaigns_daily` + `ads_daily` with FX conversion + `ON CONFLICT preserve` semantics. Re-uses the exact column shape cron-daily already writes so concurrent UPSERTs don't disagree. |
| `dashboard-web/src/inngest/functions/cronLiveHeavy.ts` | Create | The new Inngest function (one per store, factory pattern matching `cronLive.ts`'s `makeCronLive`). 30-min cron, fetches Meta+Google+TikTok per-campaign + per-ad for [today, yesterday], calls the persist helper, handles 429s via `notifyTokenFailure`. |
| `dashboard-web/src/app/api/inngest/route.ts` | Modify | Spread `cronLiveHeavyFunctions` into the `serve()` functions array. |
| `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavy.test.ts` | Create | Vitest coverage for the new function: success path, 429 rate-limit fallback, partial-platform soft-fail, today+yesterday window. |
| `dashboard-web/src/lib/notifications/__tests__/detectAuthError.test.ts` | Modify | Add tests for the new `isRateLimitError` classifier. |
| `docs/ARCHITECTURE.md` | Modify | Update §4 (Inngest functions) — list the new function and its cadence; explain co-existence with cron-daily + cron-live. |
| `docs/ROAS-Dashboard-User-Manual.md` | Modify | Update §7 (Campaigns tab) — note "live within 30 min" instead of "nightly only". |

---

## Task 1: Add rate-limit classifier

**Files:**
- Modify: `dashboard-web/src/lib/notifications/detectAuthError.ts`
- Modify: `dashboard-web/src/lib/notifications/__tests__/detectAuthError.test.ts`

- [ ] **Step 1: Read the current `detectAuthError.ts` to understand the existing classifier shape**

Run: `cat dashboard-web/src/lib/notifications/detectAuthError.ts`
Expected: a single exported function `isAuthError(provider: 'meta' | 'google' | 'tiktok' | 'shopify', errorMsg: string): boolean` that pattern-matches platform-specific auth-failure substrings.

- [ ] **Step 2: Write the failing test for `isRateLimitError`**

Append to `dashboard-web/src/lib/notifications/__tests__/detectAuthError.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isAuthError, isRateLimitError } from '../detectAuthError';

describe('isRateLimitError', () => {
  it('detects Meta 429 from message body', () => {
    expect(isRateLimitError('meta', 'Meta account spend uzoshop 2026-05-27 failed (429): { "error": { "code": 17, "message": "User request limit reached" } }')).toBe(true);
  });
  it('detects Google quota-exceeded', () => {
    expect(isRateLimitError('google', 'GAQL error 8: Resource has been exhausted (e.g. check quota)')).toBe(true);
  });
  it('detects TikTok rate-limit code 40100', () => {
    expect(isRateLimitError('tiktok', 'TikTok report failed: code=40100 message="rate limit exceeded"')).toBe(true);
  });
  it('detects fetchWithBackoff "exhausted" 429 marker', () => {
    expect(isRateLimitError('meta', 'Meta account spend failed (429): exhausted')).toBe(true);
  });
  it('returns false for auth errors (those go through isAuthError, not this one)', () => {
    expect(isRateLimitError('meta', '190: access token expired')).toBe(false);
  });
  it('returns false for generic network failures', () => {
    expect(isRateLimitError('meta', 'fetch failed: ETIMEDOUT')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `cd dashboard-web && npx vitest run src/lib/notifications/__tests__/detectAuthError.test.ts -t isRateLimitError`
Expected: fails with `isRateLimitError is not a function`.

- [ ] **Step 4: Implement `isRateLimitError` in `detectAuthError.ts`**

Append to `dashboard-web/src/lib/notifications/detectAuthError.ts`:

```typescript
/**
 * Phase 13.9 (2026-05-27) — classifier for rate-limit / quota-exhaustion
 * errors from ad platforms. Distinct from `isAuthError` because the
 * operator's mitigation is different: auth = "refresh the token", rate-
 * limit = "wait, no action needed, the system retries next tick".
 *
 * Pattern sources:
 *   - Meta:    HTTP 429 + body `{ "error": { "code": 4 | 17 | 32, ... } }` ("User request limit reached", "Application request limit").
 *   - Google:  GAQL `RESOURCE_EXHAUSTED` (code 8) or `QUOTA_EXCEEDED`.
 *   - TikTok:  code 40100 ("rate limit exceeded").
 *   - All:     fetchWithBackoff exhausts retries → returns the final 429
 *              whose body is replaced with the literal string "exhausted".
 *
 * Tight matching by substring to avoid false-positives on non-rate-limit
 * fetches; conservative because the consequence of misclassifying is
 * sending a noisy WhatsApp alert.
 */
export function isRateLimitError(
  provider: 'meta' | 'google' | 'tiktok' | 'shopify',
  errorMsg: string,
): boolean {
  if (!errorMsg) return false;
  const m = errorMsg.toLowerCase();
  // Universal: HTTP 429 in any provider's wrapped message OR the
  // withBackoff "exhausted" sentinel.
  if (m.includes('(429)') || m.includes(' 429 ') || m.includes('exhausted')) return true;
  if (provider === 'meta') {
    return (
      m.includes('user request limit reached') ||
      m.includes('application request limit') ||
      m.includes('"code": 4') ||
      m.includes('"code": 17') ||
      m.includes('"code": 32')
    );
  }
  if (provider === 'google') {
    return (
      m.includes('resource_exhausted') ||
      m.includes('resource has been exhausted') ||
      m.includes('quota_exceeded') ||
      m.includes('quota exceeded') ||
      /gaql error 8\b/.test(m)
    );
  }
  if (provider === 'tiktok') {
    return m.includes('40100') || m.includes('rate limit exceeded');
  }
  return false;
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `cd dashboard-web && npx vitest run src/lib/notifications/__tests__/detectAuthError.test.ts`
Expected: all tests pass (both existing isAuthError tests and the 6 new isRateLimitError tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/notifications/detectAuthError.ts dashboard-web/src/lib/notifications/__tests__/detectAuthError.test.ts
git commit -m "feat(notifications): add isRateLimitError classifier for HTTP 429 / quota signals"
```

---

## Task 2: Persist helper for campaigns_daily + ads_daily (one store, one date)

**Files:**
- Create: `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLive.test.ts`

This helper is a **pure** function that takes already-fetched data (no network) plus a Supabase admin client and writes the two tables. cron-live-heavy fetches the data and calls this. cron-daily is **not modified** in this plan — its existing inline writer keeps writing the same shape, and `ON CONFLICT DO UPDATE` on PK reconciles concurrent runs at the column level. Identical column shape on both writers guarantees no drift.

- [ ] **Step 1: Read the existing cron-daily writer to copy its exact column shape**

Run: `sed -n '770,1080p' dashboard-web/src/inngest/functions/cronDaily.ts`
Expected: the inline metaCampaignRows / googleCampaignRows / Meta+Google ads_daily UPSERT blocks. Note the column names, the FX `cadFor` closure, the `if (spendCad !== null) row.spend_cad = ...` preserve pattern, the BIGINT rounding for impressions/clicks/conversions, and the TikTok blocks further down.

- [ ] **Step 2: Write the failing test**

Create `dashboard-web/src/lib/inngest/__tests__/persistCampaignsLive.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { persistCampaignsLive } from '../persistCampaignsLive';

const STORE = 'uzoshop';
const DATE = '2026-05-27';

function makeAdminMock() {
  const upserts: Array<{ table: string; rows: unknown[]; onConflict?: string }> = [];
  const admin = {
    from(table: string) {
      return {
        upsert(rows: unknown[], opts?: { onConflict?: string }) {
          upserts.push({ table, rows: rows as unknown[], onConflict: opts?.onConflict });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin, upserts };
}

describe('persistCampaignsLive', () => {
  it('UPSERTs meta adset rows into campaigns_daily with spend_cad + conversion_value_cad after FX conversion', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 0.5, // 1 ILS = 0.5 CAD (mocked)
      meta: {
        adsetRows: [
          {
            campaignId: 'c1', campaignName: 'Camp 1', adSetId: 'a1', adSetName: 'AdSet 1',
            spend: 100, impressions: 1000, clicks: 50, conversions: 3,
            conversionValue: 250, currency: 'ILS',
          },
        ],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const campaignsUpsert = upserts.find(u => u.table === 'campaigns_daily');
    expect(campaignsUpsert).toBeTruthy();
    const row = (campaignsUpsert!.rows as Array<{ spend_cad: number; conversion_value_cad: number; impressions: number }>)[0];
    expect(row.spend_cad).toBeCloseTo(50);    // 100 ILS × 0.5
    expect(row.conversion_value_cad).toBeCloseTo(125); // 250 ILS × 0.5
    expect(row.impressions).toBe(1000);
  });

  it('omits spend_cad when FX fails (cadFor returns null) so ON CONFLICT preserves prior value', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => null, // FX outage
      meta: {
        adsetRows: [{ campaignId: 'c1', campaignName: 'C', adSetId: 'a1', adSetName: 'A', spend: 100, impressions: 1, clicks: 1, conversions: 1, conversionValue: 1, currency: 'ILS' }],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const campaignsUpsert = upserts.find(u => u.table === 'campaigns_daily');
    const row = campaignsUpsert!.rows[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('spend_cad');
    expect(row).not.toHaveProperty('conversion_value_cad');
    expect(row.impressions).toBe(1); // metric-only columns still update
  });

  it('uses date,store_id,platform,campaign_id,ad_set_id as the campaigns_daily onConflict key', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: { adsetRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, currency: 'CAD' }], adRows: [], budgets: { currency: 'CAD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const u = upserts.find(x => x.table === 'campaigns_daily');
    expect(u!.onConflict).toBe('date,store_id,platform,campaign_id,ad_set_id');
  });

  it('UPSERTs ads_daily for ad-level rows from all three platforms in one call', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: {
        adsetRows: [],
        adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad1', adName: 'M-ad', spend: 1, impressions: 1, clicks: 1, conversions: 1, conversionValue: 1, currency: 'CAD' }],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad2', adName: 'G-ad', spend: 2, impressions: 2, clicks: 2, conversions: 2, conversionValue: 2, effectiveStatus: 'ENABLED' }] },
      tiktok: { adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad3', adName: 'T-ad', spend: 3, impressions: 3, clicks: 3, conversions: 3, conversionValue: 3, effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK' }] },
    });
    const adsUpsert = upserts.find(u => u.table === 'ads_daily');
    expect(adsUpsert).toBeTruthy();
    expect(adsUpsert!.rows).toHaveLength(3);
  });

  it('no-op (no UPSERTs) when all three platforms returned empty arrays', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'CAD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    expect(upserts).toHaveLength(0);
  });
});

// Also leave a sanity import for vi so the linter doesn't complain on the
// (unused) re-export above.
void vi;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/inngest/__tests__/persistCampaignsLive.test.ts`
Expected: fails because the module doesn't exist yet.

- [ ] **Step 4: Implement `persistCampaignsLive`**

Create `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`:

```typescript
/**
 * Phase 13.9 (2026-05-27) — Persist per-campaign + per-ad metrics for one
 * (store, date) tuple. Called by the new `cron-live-heavy` Inngest
 * function every 30 min during the day to keep `campaigns_daily` +
 * `ads_daily` warm without waiting for cron-daily's 01:00 nightly run.
 *
 * Column shape is identical to cron-daily's inline writer (cronDaily.ts
 * persist-batch step). Both rely on `ON CONFLICT DO UPDATE` against the
 * same PK so concurrent runs reconcile per-column (last writer wins
 * for the columns it touches; absent payload keys are preserved).
 *
 * The function is pure (no Inngest step.run, no fetches) — caller pre-
 * fetches the per-platform data and pre-resolves the FX `getFx`
 * closure. This keeps it trivially testable and reusable between
 * cron-daily and cron-live-heavy if a future refactor wants to DRY
 * the writer.
 *
 * cadFor preserve semantics (CRIT-5 / O4-CR-01): when FX fails for a
 * (currency, date) pair, `getFx` returns `null` and `cadFor` propagates
 * null. Per-row builders OMIT the affected CAD key so Supabase's
 * payload-key-only SET clause leaves the prior value intact.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetaAdSetRow, MetaAdRow, MetaBudgets } from '@/lib/fetchers/meta';
import type { GoogleAdsAdGroupInsight, GoogleAdsAdInsight } from '@/lib/fetchers/googleAds';
import type { TikTokAdRow } from '@/lib/fetchers/tiktok';

export type PersistCampaignsLiveInput = {
  storeId: string;
  dateStr: string;
  admin: SupabaseClient;
  /**
   * (amount, currency) → CAD value. Caller wires this to either a real
   * `getFxRate` call or a mock. Returns `null` to signal FX outage —
   * the corresponding CAD column is then omitted from the UPSERT
   * payload to preserve the prior value.
   */
  getFx: (amount: number, currency: string) => Promise<number | null>;
  meta: {
    adsetRows: MetaAdSetRow[];
    adRows: MetaAdRow[];
    budgets: MetaBudgets;
  };
  google: {
    adGroupRows: GoogleAdsAdGroupInsight[];
    adRows: GoogleAdsAdInsight[];
  };
  tiktok: {
    adRows: TikTokAdRow[];
  };
};

export async function persistCampaignsLive(
  input: PersistCampaignsLiveInput,
): Promise<void> {
  const { storeId, dateStr, admin, getFx, meta, google, tiktok } = input;

  // FX adapter: passes through CAD currencies, calls getFx for the rest.
  // null result → caller skips writing the CAD column.
  async function cadFor(amount: number, currency: string): Promise<number | null> {
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    const cur = (currency || 'CAD').toUpperCase();
    if (cur === 'CAD') return amount;
    const rate = await getFx(amount, cur);
    if (rate === null || !Number.isFinite(rate)) return null;
    return amount * rate;
  }

  // ---------- campaigns_daily — Meta rows ----------
  type MetaCampaignRow = {
    date: string; store_id: string; platform: 'meta';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    impressions: number; clicks: number; conversions: number;
    roas: null;
    budget_type: 'CBO' | 'ABO' | '';
    effective_status: string | null;
    spend_cad?: number;
    conversion_value_cad?: number;
    campaign_budget_cad?: number | null;
    ad_set_budget_cad?: number | null;
  };
  const metaRows: MetaCampaignRow[] = [];
  for (const r of meta.adsetRows) {
    const cBud = meta.budgets.campaigns[r.campaignId];
    const aBud = meta.budgets.adSets[r.adSetId];
    const cDaily = cBud?.dailyBudget ?? 0;
    const cLifetime = cBud?.lifetimeBudget ?? 0;
    const aDaily = aBud?.dailyBudget ?? 0;
    const aLifetime = aBud?.lifetimeBudget ?? 0;
    const campaignBudgetRaw = cDaily > 0 ? cDaily : cLifetime;
    const adSetBudgetRaw = aDaily > 0 ? aDaily : aLifetime;
    let bt: 'CBO' | 'ABO' | '' = '';
    if (campaignBudgetRaw > 0) bt = 'CBO';
    else if (adSetBudgetRaw > 0) bt = 'ABO';
    const effectiveStatus = aBud?.effectiveStatus ?? cBud?.effectiveStatus ?? null;
    const spendCad = await cadFor(r.spend, r.currency);
    const convValueCad = await cadFor(r.conversionValue, r.currency);
    const campaignBudgetCad = campaignBudgetRaw > 0
      ? await cadFor(campaignBudgetRaw, meta.budgets.currency)
      : null;
    const adSetBudgetCad = adSetBudgetRaw > 0
      ? await cadFor(adSetBudgetRaw, meta.budgets.currency)
      : null;
    const row: MetaCampaignRow = {
      date: dateStr,
      store_id: storeId,
      platform: 'meta',
      campaign_id: r.campaignId,
      campaign_name: r.campaignName,
      ad_set_id: r.adSetId,
      ad_set_name: r.adSetName,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      conversions: Math.round(r.conversions),
      roas: null,
      budget_type: bt,
      effective_status: effectiveStatus,
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    if (campaignBudgetRaw === 0) row.campaign_budget_cad = null;
    else if (campaignBudgetCad !== null) row.campaign_budget_cad = campaignBudgetCad;
    if (adSetBudgetRaw === 0) row.ad_set_budget_cad = null;
    else if (adSetBudgetCad !== null) row.ad_set_budget_cad = adSetBudgetCad;
    metaRows.push(row);
  }

  // ---------- campaigns_daily — Google rows ----------
  const googleRows = google.adGroupRows.map((r) => ({
    date: dateStr,
    store_id: storeId,
    platform: 'google' as const,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    ad_set_id: r.adSetId,
    ad_set_name: r.adSetName,
    spend_cad: r.spend,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    conversions: Math.round(r.conversions),
    conversion_value_cad: r.conversionValue,
    roas: null,
    campaign_budget_cad: null,
    ad_set_budget_cad: null,
    budget_type: null,
    effective_status: r.effectiveStatus ?? null,
  }));

  // ---------- campaigns_daily — TikTok rows ----------
  type TikTokCampaignRow = {
    date: string; store_id: string; platform: 'tiktok';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    impressions: number; clicks: number; conversions: number;
    roas: null;
    budget_type: null;
    campaign_budget_cad: null;
    ad_set_budget_cad: null;
    effective_status: string | null;
    spend_cad?: number;
    conversion_value_cad?: number;
  };
  // TikTok aggregates per (campaign, adset) by summing the ad-level rows.
  // Matches cron-daily's aggregation (TikTok doesn't have a level=adset
  // endpoint that returns budgets the same way Meta does).
  const ttGroups = new Map<string, {
    campaignId: string; campaignName: string; adSetId: string; adSetName: string;
    spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number;
    currency: string; effectiveStatus: string | null;
  }>();
  for (const r of tiktok.adRows) {
    const k = `${r.campaignId}::${r.adSetId}`;
    let g = ttGroups.get(k);
    if (!g) {
      g = {
        campaignId: r.campaignId, campaignName: r.campaignName,
        adSetId: r.adSetId, adSetName: r.adSetName,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
        currency: 'USD', effectiveStatus: r.effectiveStatus ?? null,
      };
      ttGroups.set(k, g);
    }
    g.spend += r.spend;
    g.impressions += r.impressions;
    g.clicks += r.clicks;
    g.conversions += r.conversions;
    g.conversionValue += r.conversionValue;
  }
  const ttRows: TikTokCampaignRow[] = [];
  for (const g of ttGroups.values()) {
    const spendCad = await cadFor(g.spend, g.currency);
    const convValueCad = await cadFor(g.conversionValue, g.currency);
    const row: TikTokCampaignRow = {
      date: dateStr,
      store_id: storeId,
      platform: 'tiktok',
      campaign_id: g.campaignId,
      campaign_name: g.campaignName,
      ad_set_id: g.adSetId,
      ad_set_name: g.adSetName,
      impressions: Math.round(g.impressions),
      clicks: Math.round(g.clicks),
      conversions: Math.round(g.conversions),
      roas: null,
      budget_type: null,
      campaign_budget_cad: null,
      ad_set_budget_cad: null,
      effective_status: g.effectiveStatus,
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    ttRows.push(row);
  }

  // ---------- campaigns_daily UPSERT (mixed-platform array; supabase handles it) ----------
  const allCampaignRows: unknown[] = [...metaRows, ...googleRows, ...ttRows];
  if (allCampaignRows.length > 0) {
    const { error } = await admin
      .from('campaigns_daily')
      .upsert(allCampaignRows, { onConflict: 'date,store_id,platform,campaign_id,ad_set_id' });
    if (error) {
      throw new Error(`campaigns_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }

  // ---------- ads_daily — all three platforms in one UPSERT ----------
  type MetaAdsRow = {
    date: string; store_id: string; platform: 'meta';
    campaign_id: string; campaign_name: string;
    ad_set_id: string; ad_set_name: string;
    ad_id: string; ad_name: string;
    impressions: number; clicks: number; conversions: number;
    spend_cad?: number;
    conversion_value_cad?: number;
  };
  const metaAdRows: MetaAdsRow[] = [];
  for (const r of meta.adRows) {
    const spendCad = await cadFor(r.spend, r.currency);
    const convValueCad = await cadFor(r.conversionValue, r.currency);
    const row: MetaAdsRow = {
      date: dateStr,
      store_id: storeId,
      platform: 'meta',
      campaign_id: r.campaignId,
      campaign_name: r.campaignName,
      ad_set_id: r.adSetId,
      ad_set_name: r.adSetName,
      ad_id: r.adId,
      ad_name: r.adName,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      conversions: Math.round(r.conversions),
    };
    if (spendCad !== null) row.spend_cad = spendCad;
    if (convValueCad !== null) row.conversion_value_cad = convValueCad;
    metaAdRows.push(row);
  }
  const googleAdRows = google.adRows.map((r) => ({
    date: dateStr,
    store_id: storeId,
    platform: 'google' as const,
    campaign_id: r.campaignId,
    campaign_name: r.campaignName,
    ad_set_id: r.adSetId,
    ad_set_name: r.adSetName,
    ad_id: r.adId,
    ad_name: r.adName,
    spend_cad: r.spend,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    conversions: Math.round(r.conversions),
    conversion_value_cad: r.conversionValue,
  }));
  const tiktokAdRows = await Promise.all(
    tiktok.adRows.map(async (r) => {
      const spendCad = await cadFor(r.spend, 'USD');
      const convValueCad = await cadFor(r.conversionValue, 'USD');
      const row: Record<string, unknown> = {
        date: dateStr,
        store_id: storeId,
        platform: 'tiktok' as const,
        campaign_id: r.campaignId,
        campaign_name: r.campaignName,
        ad_set_id: r.adSetId,
        ad_set_name: r.adSetName,
        ad_id: r.adId,
        ad_name: r.adName,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        conversions: Math.round(r.conversions),
      };
      if (spendCad !== null) row.spend_cad = spendCad;
      if (convValueCad !== null) row.conversion_value_cad = convValueCad;
      return row;
    }),
  );
  const allAdRows: unknown[] = [...metaAdRows, ...googleAdRows, ...tiktokAdRows];
  if (allAdRows.length > 0) {
    const { error } = await admin
      .from('ads_daily')
      .upsert(allAdRows, { onConflict: 'date,store_id,platform,ad_id' });
    if (error) {
      throw new Error(`ads_daily upsert ${storeId} ${dateStr}: ${error.message}`);
    }
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd dashboard-web && npx vitest run src/lib/inngest/__tests__/persistCampaignsLive.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 6: Run tsc to catch any type errors**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/lib/inngest/persistCampaignsLive.ts dashboard-web/src/lib/inngest/__tests__/persistCampaignsLive.test.ts
git commit -m "feat(inngest): add persistCampaignsLive helper for cron-live-heavy + cron-daily reuse"
```

---

## Task 3: cron-live-heavy Inngest function (factory + handler)

**Files:**
- Create: `dashboard-web/src/inngest/functions/cronLiveHeavy.ts`
- Create: `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavy.test.ts`

- [ ] **Step 1: Read the existing cron-live factory + handler shape to match**

Run: `sed -n '1660,1720p' dashboard-web/src/inngest/functions/cronLive.ts`
Expected: the `makeCronLive(storeId)` factory + the `cronLiveFunctions` exported array of three (one per store).

- [ ] **Step 2: Write the failing test (success path + rate-limit fallback)**

Create `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavy.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const STORE = 'uzoshop';
const TODAY = '2026-05-27';
const YESTERDAY = '2026-05-26';

vi.mock('@/lib/notifications/tokenFailures', () => ({
  notifyTokenFailure: vi.fn(async () => ({ alerted: true, throttled: false, dbWritten: true })),
}));

vi.mock('@/lib/inngest/persistCampaignsLive', () => ({
  persistCampaignsLive: vi.fn(async () => {}),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaAdSetInsights: vi.fn(async () => []),
  fetchMetaAdInsights: vi.fn(async () => []),
  fetchMetaBudgets: vi.fn(async () => ({ currency: 'ILS', campaigns: {}, adSets: {} })),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => []),
  fetchGoogleAdsAdInsights: vi.fn(async () => []),
}));

vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokAdInsights: vi.fn(async () => []),
}));

vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async () => 1),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
}));

vi.mock('@/lib/getTodayInIsrael', () => ({
  todayInIsrael: () => TODAY,
}));

// Inngest step stub — mirrors the one in cronLive.test.ts.
function makeStepStub() {
  return {
    step: {
      async run<T>(_id: string, cb: () => Promise<T>): Promise<T> {
        return cb();
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cron-live-heavy runHeavyForStore', () => {
  it('fetches all three platforms for today + yesterday and calls persistCampaignsLive per (store, date)', async () => {
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    // 2 dates × 1 persist call each = 2 calls
    expect(persistCampaignsLive).toHaveBeenCalledTimes(2);
    const calls = (persistCampaignsLive as ReturnType<typeof vi.fn>).mock.calls;
    const dates = calls.map((c) => (c[0] as { dateStr: string }).dateStr).sort();
    expect(dates).toEqual([YESTERDAY, TODAY]);
  });

  it('on Meta rate-limit (429): skips Meta, still calls persistCampaignsLive with empty meta, fires WhatsApp alert', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Meta account insights uzoshop 2026-05-27 failed (429): { "error": { "code": 17 } }'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        storeId: STORE,
        operation: expect.stringContaining('rate_limit'),
      }),
    );
    // persist still runs (Google + TikTok rows still flow through; Meta is empty).
    expect(persistCampaignsLive).toHaveBeenCalled();
    const todayCall = (persistCampaignsLive as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { dateStr: string }).dateStr === TODAY,
    );
    expect(todayCall).toBeTruthy();
    expect((todayCall![0] as { meta: { adsetRows: unknown[] } }).meta.adsetRows).toEqual([]);
  });

  it('on Meta auth failure (NOT rate-limit): fires WhatsApp via tokenFailure with provider=meta and skips Meta', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Meta insights failed: { "error": { "code": 190, "message": "Access token expired" } }'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta', storeId: STORE }),
    );
  });

  it('does NOT call notifyTokenFailure on non-auth non-rate-limit errors (just logs)', async () => {
    const meta = await import('@/lib/fetchers/meta');
    (meta.fetchMetaAdSetInsights as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('fetch failed: ETIMEDOUT'),
    );
    const { runHeavyForStore } = await import('../cronLiveHeavy');
    const { notifyTokenFailure } = await import('@/lib/notifications/tokenFailures');
    const { step } = makeStepStub();
    await runHeavyForStore(STORE, { step });
    expect(notifyTokenFailure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronLiveHeavy.test.ts`
Expected: fails because `../cronLiveHeavy` doesn't exist yet.

- [ ] **Step 4: Implement `cronLiveHeavy.ts`**

Create `dashboard-web/src/inngest/functions/cronLiveHeavy.ts`:

```typescript
/**
 * Phase 13.9 (2026-05-27) — cron-live-heavy.
 *
 * Runs every 30 minutes (Asia/Jerusalem). For each store + each date in
 * the rolling 2-day window [today, yesterday]:
 *   1. Fetches Meta adset insights + ad insights + budgets
 *   2. Fetches Google ad-group insights + ad insights
 *   3. Fetches TikTok ad insights
 *   4. Calls persistCampaignsLive() to UPSERT campaigns_daily + ads_daily
 *
 * Co-exists with cron-daily (runs once at 01:00) and cron-live (runs
 * every 10 min, writes only data_daily + status placeholders to
 * campaigns_daily without metric columns). Same Supabase UPSERT keys,
 * so concurrent writes reconcile per-column.
 *
 * Rate-limit & auth failures soft-fail per-platform: when a platform's
 * fetcher throws, we (a) classify the error, (b) fire a throttled
 * WhatsApp alert via notifyTokenFailure when appropriate, and (c) let
 * the persist step run for the platforms that DID succeed. Next tick
 * (30 min later) retries.
 */

import { inngest } from '@/inngest/client';
import {
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaBudgets,
  type MetaAdSetRow,
  type MetaAdRow,
  type MetaBudgets,
} from '@/lib/fetchers/meta';
import {
  fetchGoogleAdsAdGroupInsights,
  fetchGoogleAdsAdInsights,
  type GoogleAdsAdGroupInsight,
  type GoogleAdsAdInsight,
} from '@/lib/fetchers/googleAds';
import { fetchTikTokAdInsights, type TikTokAdRow } from '@/lib/fetchers/tiktok';
import { getFxRate } from '@/lib/fetchers/fx';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { todayInIsrael } from '@/lib/getTodayInIsrael';
import { persistCampaignsLive } from '@/lib/inngest/persistCampaignsLive';
import { isAuthError, isRateLimitError } from '@/lib/notifications/detectAuthError';
import { notifyTokenFailure } from '@/lib/notifications/tokenFailures';

type StoreId = 'uzoshop' | 'zolplus' | 'usmile360';
const ALL_STORES: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'];

// Tracks which fetcher threw — used by the per-platform soft-fail path to
// classify the error and fire a throttled WhatsApp alert. Each platform
// gets its own bucket so a Meta auth-failure doesn't shadow Google's.
type PlatformFailure = {
  provider: 'meta' | 'google' | 'tiktok';
  errorMsg: string;
};

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Subset of Inngest's step API we use — matches the StepRunner pattern
 *  in cronLive.ts. */
type StepRunner = {
  run<T>(id: string, cb: () => Promise<T>): Promise<T>;
};

export async function runHeavyForStore(
  storeId: StoreId,
  { step }: { step: StepRunner },
): Promise<void> {
  const today = todayInIsrael();
  const yesterday = addDaysIso(today, -1);
  const dates = [today, yesterday];

  // FX closure shared across all dates / currencies for this tick.
  async function getFx(amount: number, currency: string): Promise<number | null> {
    if (amount === 0) return 0;
    try {
      const rate = await getFxRate(currency.toUpperCase(), 'CAD', today);
      if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
      return rate;
    } catch {
      return null;
    }
  }

  for (const date of dates) {
    await step.run(`fetch-and-persist-${storeId}-${date}`, async () => {
      const failures: PlatformFailure[] = [];

      const metaEmpty = {
        adsetRows: [] as MetaAdSetRow[],
        adRows: [] as MetaAdRow[],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} } as MetaBudgets,
      };
      const googleEmpty = {
        adGroupRows: [] as GoogleAdsAdGroupInsight[],
        adRows: [] as GoogleAdsAdInsight[],
      };
      const tiktokEmpty = { adRows: [] as TikTokAdRow[] };

      const meta = await (async () => {
        try {
          const [adsetRows, adRows, budgets] = await Promise.all([
            fetchMetaAdSetInsights(storeId, date),
            fetchMetaAdInsights(storeId, date),
            fetchMetaBudgets(storeId),
          ]);
          return { adsetRows, adRows, budgets };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'meta', errorMsg: msg });
          return metaEmpty;
        }
      })();

      const google = await (async () => {
        try {
          const [adGroupRows, adRows] = await Promise.all([
            fetchGoogleAdsAdGroupInsights(storeId, date),
            fetchGoogleAdsAdInsights(storeId, date),
          ]);
          return { adGroupRows, adRows };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'google', errorMsg: msg });
          return googleEmpty;
        }
      })();

      const tiktok = await (async () => {
        try {
          const adRows = await fetchTikTokAdInsights(storeId, date);
          return { adRows };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ provider: 'tiktok', errorMsg: msg });
          return tiktokEmpty;
        }
      })();

      // Fire per-platform alerts BEFORE persist — even if persist fails
      // operator still sees the upstream cause.
      for (const f of failures) {
        const isRate = isRateLimitError(f.provider, f.errorMsg);
        const isAuth = isAuthError(f.provider, f.errorMsg);
        if (isRate || isAuth) {
          await notifyTokenFailure({
            provider: f.provider,
            storeId,
            operation: isRate ? `cron_live_heavy_rate_limit_${date}` : `cron_live_heavy_auth_${date}`,
            errorMsg: f.errorMsg,
            advice: isRate
              ? 'Platform reported HTTP 429 / quota-exceeded. cron-live-heavy will retry on the next tick (30 min). No operator action needed unless this persists across multiple ticks.'
              : 'Refresh the platform access token in Vercel and redeploy. See docs/PROPS-MAP.md for the per-platform env var name.',
          }).catch((alertErr) => {
            console.warn(
              `cron-live-heavy: notifyTokenFailure threw for ${f.provider}/${storeId}/${date}: ${alertErr instanceof Error ? alertErr.message : alertErr}`,
            );
          });
        } else {
          console.warn(
            `cron-live-heavy: ${f.provider} fetch failed for ${storeId} ${date} (no alert — neither rate-limit nor auth): ${f.errorMsg}`,
          );
        }
      }

      // Persist whatever did succeed. If all three platforms failed this
      // tick, persistCampaignsLive sees three empty arrays and short-
      // circuits (no UPSERTs).
      await persistCampaignsLive({
        storeId,
        dateStr: date,
        admin: getSupabaseAdmin(),
        getFx,
        meta,
        google,
        tiktok,
      });
    });
  }
}

function makeCronLiveHeavy(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-live-heavy-${storeId}`,
      // Every 30 min, Asia/Jerusalem. Sits between cron-live (10 min,
      // light) and cron-daily (01:00, full). The 30-min cadence is
      // calibrated to stay under Meta's per-app rate limit for tier-2
      // accounts (~600 calls/h) given 6 fetches × 2 dates × 3 stores
      // per tick + Meta's standard insights paging.
      triggers: [{ cron: 'TZ=Asia/Jerusalem */30 * * * *' }],
    },
    async ({ step }) =>
      runHeavyForStore(storeId, { step: step as unknown as StepRunner }),
  );
}

export const cronLiveHeavyFunctions = ALL_STORES.map(makeCronLiveHeavy);
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/cronLiveHeavy.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 6: Run tsc**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/inngest/functions/cronLiveHeavy.ts dashboard-web/src/inngest/functions/__tests__/cronLiveHeavy.test.ts
git commit -m "feat(inngest): cron-live-heavy — 30-min per-campaign + per-ad refresh for today + yesterday"
```

---

## Task 4: Register the new function in the Inngest serve route

**Files:**
- Modify: `dashboard-web/src/app/api/inngest/route.ts`

- [ ] **Step 1: Read the current functions array to confirm shape**

Run: `sed -n '95,125p' dashboard-web/src/app/api/inngest/route.ts`
Expected: the `serve({ client: inngest, functions: [...cronDailyFunctions, ...cronLiveFunctions, ...] })` block.

- [ ] **Step 2: Add the import + spread**

Edit `dashboard-web/src/app/api/inngest/route.ts`:

Find:
```typescript
import { cronLiveFunctions } from '@/inngest/functions/cronLive';
```

Add immediately below:
```typescript
import { cronLiveHeavyFunctions } from '@/inngest/functions/cronLiveHeavy';
```

Find:
```typescript
    ...cronLiveFunctions, // 3 functions (uzoshop / zolplus / usmile360)
```

Add immediately below:
```typescript
    ...cronLiveHeavyFunctions, // Phase 13.9 — 3 functions (per-store, 30-min cadence) refreshing campaigns_daily + ads_daily metrics for today + yesterday.
```

- [ ] **Step 3: Run tsc to confirm the import resolves**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the full vitest suite to confirm nothing regressed**

Run: `cd dashboard-web && npx vitest run`
Expected: all tests pass (previous count was 1105 tests across 117 files; this plan adds ~12 tests across 3 files, expect ~1117 / 119+).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/app/api/inngest/route.ts
git commit -m "feat(inngest): register cronLiveHeavyFunctions in serve() route"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md` §4.1
- Modify: `docs/ROAS-Dashboard-User-Manual.md` §7 (Campaigns tab) intro

- [ ] **Step 1: Update ARCHITECTURE.md §4.1 (function inventory)**

Find the `### 4.1 9 פונקציות הליבה` heading and update the count + add the new row. Replace the existing intro sentence and add a new bullet describing cron-live-heavy with its cadence + scope + co-existence note.

Concretely, add this paragraph after the cron-live description in §4.1:

```markdown
**`cron-live-heavy-{store}`** (Phase 13.9 — 2026-05-27). Cron `TZ=Asia/Jerusalem */30 * * * *`. For each store × each date in [today, yesterday]: fetches Meta adset+ad insights + budgets, Google ad-group+ad insights, TikTok ad insights; calls `persistCampaignsLive()` to UPSERT `campaigns_daily` + `ads_daily`. Co-exists with cron-daily (01:00 nightly full run) and cron-live (10-min light spend + status). All three writers UPSERT the same PKs so `ON CONFLICT DO UPDATE` reconciles per-column; the latest write wins for the columns it touches. Rate-limit (429) and auth failures soft-fail per-platform → throttled WhatsApp alert via `notifyTokenFailure` → next tick retries.
```

Also update the function count from "9 פונקציות" to "12 פונקציות" (existing 9 + 3 new per-store cron-live-heavy).

- [ ] **Step 2: Update User Manual §7 intro**

Find the existing §7 intro line and add a sentence noting live refresh:

```markdown
**עדכון בזמן אמת** (Phase 13.9 — 2026-05-27): נתוני הקמפיינים מתעדכנים כל **30 דקות** בטווח [היום, אתמול]. עד 2026-05-27 הנתונים התעדכנו רק פעם בלילה ב-01:00 IL, מה שגרם לטור "היום" להיות ריק לאורך כל היום. Phase 13.9 הוסיף את cron-live-heavy שמרענן את `campaigns_daily` ו-`ads_daily` ב-cadence של 30 דק' — קריאות API חדשות לפלטפורמות (Meta, Google, TikTok) בכל ריצה.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(phase-13-9): document cron-live-heavy in ARCHITECTURE + User Manual"
```

---

## Task 6: Smoke-verify production after deploy

**Files:** none (manual verification step).

- [ ] **Step 1: Push + wait for Vercel deploy**

```bash
git push origin main
```

Wait until the deploy is live. The pre-push hook will run tsc + vitest + lint + docs-currency — they should all pass given Tasks 1-5.

- [ ] **Step 2: Wait for the first cron-live-heavy tick after deploy**

The cron fires every 30 min on the half-hour boundary (TZ=Asia/Jerusalem `*/30 * * * *`). After the deploy lands, the next firing is at the next :00 or :30. Wait until then + ~60 sec for the function to finish.

- [ ] **Step 3: Verify campaigns_daily for today has fresh metric rows**

Run (using the production URL — see `feedback_no_localhost_checks` memory):

```bash
curl -s "https://roas-dashboard-smoky.vercel.app/api/campaigns?from=$(TZ=Asia/Jerusalem date +%Y-%m-%d)&to=$(TZ=Asia/Jerusalem date +%Y-%m-%d)" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('rows', [])
total_spend = sum(r.get('spend', 0) for r in rows)
total_imp = sum(r.get('impressions', 0) for r in rows)
print(f'today: {len(rows)} rows · spend = CAD {total_spend:.2f} · impressions = {total_imp}')
"
```

Expected: spend > 0 AND impressions > 0 (assuming the day has had ad delivery). If both are 0, check Inngest dashboard for the cron-live-heavy run status.

- [ ] **Step 4: Verify ads_daily for today has fresh rows**

Run:

```bash
curl -s "https://roas-dashboard-smoky.vercel.app/api/ads?from=$(TZ=Asia/Jerusalem date +%Y-%m-%d)&to=$(TZ=Asia/Jerusalem date +%Y-%m-%d)" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('rows', [])
print(f'today ads: {len(rows)} rows · platforms = {set(r.get(\"platform\") for r in rows)}')
"
```

Expected: rows count > 0 AND platforms set includes 'meta' (and 'google', 'tiktok' for stores wired to them).

- [ ] **Step 5: Verify the dashboard UI shows non-zero numbers on Campaigns tab for today**

Open `https://roas-dashboard-smoky.vercel.app/` in a browser, select today as the range, and confirm the Campaigns table rows show non-zero `הוצאה`, `המרות`, `ערך המרות` for active campaigns.

- [ ] **Step 6: Update the Phase log in ARCHITECTURE.md §20 + memory**

After verification confirms it works, update `docs/ARCHITECTURE.md §20 Phase log` with the SHIPPED entry, and write a `project_cron_live_heavy_phase_13_9.md` memory file pointing to the commit + a one-line description. Update `MEMORY.md` index.

---

## Self-review checklist (run after writing the plan)

- ✅ **Spec coverage**: scope items 1-4 from pre-flight all covered (Task 2 covers writes; Task 3 covers fetch + window + 429 fallback; Task 4 wires it into the cron registry).
- ✅ **Placeholder scan**: no "TBD" / "implement later" / "similar to" — all code blocks complete.
- ✅ **Type consistency**: `MetaAdSetRow` / `MetaAdRow` / `MetaBudgets` / `GoogleAdsAdGroupInsight` / `GoogleAdsAdInsight` / `TikTokAdRow` re-exported from `@/lib/fetchers/*` — same names used in cron-daily.
- ✅ **Risk**: cron-daily is NOT modified. Concurrent UPSERTs to the same PK on `campaigns_daily` and `ads_daily` are safe because both writers produce identical column shapes; Supabase's payload-key-only SET clause means whichever runs later wins for the columns it writes, and absent keys preserve. Worst-case race: cron-daily and cron-live-heavy fire within seconds of each other (01:00 boundary) — both write the same numbers, result is a no-op rewrite of the same values.
- ✅ **Rate-limit blast radius**: 30-min cadence × 3 stores × 6 fetches/store × 2 dates = 36 fetches per half-hour. Meta tier-2 rate limit is ~600/h, Google's default GAQL is ~15k ops/day, TikTok ~600/min — comfortable margin.

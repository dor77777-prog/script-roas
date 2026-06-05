# Creative-Fatigue Frequency Leg + Early-Warning Insight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ad-impression **frequency** (impressions ÷ reach) as a new, separate, *earlier* "early-warning" creative-fatigue insight (Meta + TikTok; Google-blind), backed by a new `ads_daily.reach` column populated nightly + by a one-off backfill.

**Architecture:** New nullable `reach` column on `ads_daily` (and the `ads_enriched` view re-created so its `a.*` re-expands to include it). The nightly fetchers (`fetchMetaAdInsights`, `fetchTikTokAdInsights`) pull reach; `cronDaily` writes it for Meta + TikTok ad rows. A one-off `backfillAdsReach.ts` reuses those fetchers to populate history. The reader threads `reach` onto `AdRow`. A new `detectAdFatigueEarlyWarning` (sibling of `detectAdFatigue`, sharing module-private grouping/half-split helpers) fires a softer insight when frequency climbs ≥20% — suppressed when the existing strong CTR↓+CPM↑ rule already fires.

**Tech Stack:** Next.js / TypeScript, Supabase (Postgres), Inngest, Vitest (node + jsdom configs), `npx tsx` scripts.

**Spec:** `docs/superpowers/specs/2026-06-05-creative-fatigue-frequency-leg-design.md`

**Conventions (read before starting):**
- Tests run with `npx vitest run <file>` (node config) for `src/lib/**` and `src/inngest/**`; the detector + fetcher tests are node-config (NOT `.dom.test`).
- Migrations are written now, **applied only on operator "go"** via the documented procedure (hide root `.env`, move the 2 duplicate-timestamp gap files out, `supabase db push`, restore). See memory `reference-supabase-migration-procedure`.
- Deploy = `git push origin main` only. One push at the end.
- Per-task commits. Co-Author trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File map

| File | Change |
|------|--------|
| `supabase/migrations/20260605130000_add_reach_to_ads_daily.sql` | **Create** — add `reach` col + DROP/CREATE `ads_enriched` + grant |
| `dashboard-web/src/lib/ads.ts` | **Modify** — add `reach?: number \| null` to `AdRow` |
| `dashboard-web/src/lib/postgresReaders.ts` | **Modify** — select `reach` from `ads_enriched`, map onto `AdRow` |
| `dashboard-web/src/lib/fetchers/meta.ts` | **Modify** — `fetchMetaAdInsights` pulls `reach`; `MetaAdRow.reach` |
| `dashboard-web/src/lib/fetchers/tiktok.ts` | **Modify** — `fetchTikTokAdInsights` pulls `reach`; `TikTokAdRow.reach` |
| `dashboard-web/src/inngest/functions/cronDaily.ts` | **Modify** — Meta + TikTok ad-row upserts include `reach` |
| `dashboard-web/src/lib/insights/adFatigue.ts` | **Modify** — reach in `HalfAgg`; extract `groupAds`/`splitHalves`; `freqNote`; new `detectAdFatigueEarlyWarning` |
| `dashboard-web/src/lib/insights.ts` | **Modify** — wire `detectAdFatigueEarlyWarning` into the pipeline |
| `dashboard-web/src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts` | **Create** — early-warning unit tests |
| `dashboard-web/src/lib/fetchers/__tests__/metaAdReach.test.ts` | **Create** — Meta reach parse test |
| `dashboard-web/src/lib/fetchers/__tests__/tiktokAdReach.test.ts` | **Create** — TikTok reach parse test |
| `dashboard-web/scripts/backfillAdsReach.ts` | **Create** — one-off Meta+TikTok reach backfill |
| `docs/ROAS-Dashboard-User-Manual.md` | **Modify** — version bump + changelog (new insight) |
| `docs/ARCHITECTURE.md` | **Modify** — note `ads_daily.reach` + backfill + early-warning |

**Going-forward scope note:** the intraday live-tick path (`persistCampaignsLive` + `metaHotMetrics`/`tiktokHotMetrics` + workers) is **intentionally NOT** wired for reach. The detector uses ≥12-day windows; the authoritative nightly `cronDaily` write + backfill cover correctness. Today's intraday reach simply lands at the nightly run — negligible for a 12-day window. (Documented as a non-goal in the spec.)

---

### Task 1: Migration — `ads_daily.reach` + recreate `ads_enriched`

**Files:**
- Create: `supabase/migrations/20260605130000_add_reach_to_ads_daily.sql`

**Why DROP/CREATE not CREATE OR REPLACE:** `ads_enriched` is `SELECT a.*, …` from `ads_daily`. Postgres expands `a.*` at view-definition time; adding `reach` to the table does not surface it until the view is rebuilt. Re-expanding `a.*` inserts `reach` *in the middle* of the column list (before the `reg_*` aliases), which `CREATE OR REPLACE VIEW` forbids ("cannot change column order"). So drop then create.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260605130000_add_reach_to_ads_daily.sql
--
-- Creative-fatigue frequency leg (2026-06-05).
-- Add ad-level daily reach (unique people) to ads_daily so the dashboard can
-- derive frequency = impressions / reach for the early-warning fatigue insight.
-- Meta + TikTok populate it; Google leaves it NULL (no per-user frequency on
-- Search/Shopping/PMax). Additive + nullable → no writer/reader breaks.

ALTER TABLE ads_daily ADD COLUMN IF NOT EXISTS reach BIGINT;

-- ads_enriched is `SELECT a.*` from ads_daily; the view's column list was frozen
-- at creation, so it must be rebuilt to surface the new column. DROP+CREATE
-- (not CREATE OR REPLACE) because a.* re-expansion places `reach` mid-list,
-- which CREATE OR REPLACE rejects. Body is identical to
-- 20260605120000_enriched_views_coalesce_name.sql (ads_enriched only).
DROP VIEW IF EXISTS ads_enriched;
CREATE VIEW ads_enriched AS
SELECT
  a.*,
  arr.configured_status        AS reg_configured_status,
  arr.effective_status         AS reg_effective_status,
  arr.delivery_status          AS reg_delivery_status,
  arr.is_enabled               AS reg_is_enabled,
  arr.is_serving               AS reg_is_serving,
  arr.first_seen_at            AS reg_first_seen_at,
  arr.last_seen_at             AS reg_last_seen_at,
  arr.status_changed_at        AS reg_status_changed_at,
  arr.last_status_success_at   AS reg_last_status_success_at,
  arr.last_metrics_success_at  AS reg_last_metrics_success_at,
  arr.missed_seen_count        AS reg_missed_seen_count,
  arr.is_removed               AS reg_is_removed,
  COALESCE(NULLIF(crr.name, ''), a.campaign_name)  AS reg_campaign_name,
  COALESCE(NULLIF(arr2.name, ''), a.ad_set_name)   AS reg_ad_set_name,
  COALESCE(NULLIF(arr.name, ''), a.ad_name)        AS reg_ad_name
FROM ads_daily a
LEFT JOIN ad_registry arr
  ON  arr.store_id = a.store_id
  AND arr.platform = a.platform
  AND arr.ad_id    = a.ad_id
LEFT JOIN campaign_registry crr
  ON  crr.store_id    = a.store_id
  AND crr.platform    = a.platform
  AND crr.campaign_id = a.campaign_id
LEFT JOIN adset_registry arr2
  ON  arr2.store_id = a.store_id
  AND arr2.platform = a.platform
  AND arr2.adset_id = a.ad_set_id;

GRANT SELECT ON ads_enriched TO anon;
```

- [ ] **Step 2: Verify SQL parses locally (lint only — do NOT apply yet)**

Run: `ls -1 supabase/migrations/20260605130000_add_reach_to_ads_daily.sql`
Expected: the file path prints. (Application happens in Task 10, operator-gated.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260605130000_add_reach_to_ads_daily.sql
git commit -m "feat(db): add ads_daily.reach + rebuild ads_enriched (creative-fatigue freq leg)"
```

---

### Task 2: `AdRow.reach` + reader projection

**Files:**
- Modify: `dashboard-web/src/lib/ads.ts:12-40` (AdRow type)
- Modify: `dashboard-web/src/lib/postgresReaders.ts:1079-1145` (select + map)

- [ ] **Step 1: Add `reach` to the `AdRow` type**

In `src/lib/ads.ts`, inside `export type AdRow = { … }`, add after the `conversionValue` line:

```ts
  conversionValue: number;  // CAD
  /**
   * Ad-level daily unique reach (people). Meta + TikTok populate it; Google
   * leaves it null (no per-user frequency on Search/Shopping/PMax). Drives the
   * creative-fatigue early-warning's frequency = impressions / reach.
   */
  reach?: number | null;
```

- [ ] **Step 2: Add `reach` to the reader SELECT**

In `src/lib/postgresReaders.ts`, in `fetchAdsFromPostgres`, extend the select string — change the `'spend_cad, impressions, clicks, '` line to include `reach`:

```ts
            'spend_cad, impressions, clicks, reach, ' +
```

- [ ] **Step 3: Map `reach` onto the row**

In the same function's `rows.push({ … })`, add after the `conversionValue: toNumber(r.conversion_value_cad),` line:

```ts
      conversionValue: toNumber(r.conversion_value_cad),
      reach:
        (r as { reach?: number | string | null }).reach == null
          ? null
          : toNumber((r as { reach?: number | string }).reach),
```

- [ ] **Step 4: Typecheck**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0 (no errors).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/ads.ts dashboard-web/src/lib/postgresReaders.ts
git commit -m "feat(ads): thread ads_daily.reach onto AdRow via ads_enriched"
```

---

### Task 3: Meta nightly fetcher pulls `reach`

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/meta.ts:92-119` (MetaAdRow), `:506-576` (fetchMetaAdInsights)
- Test: `dashboard-web/src/lib/fetchers/__tests__/metaAdReach.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-web/src/lib/fetchers/__tests__/metaAdReach.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fetchMetaAdInsights reads creds from env via getMetaToken/getMetaAdAccountId.
// Set the minimum env the uzoshop path needs, then stub global fetch.
beforeEach(() => {
  process.env.UZOSHOP_META_ACCESS_TOKEN = 'tok';
  process.env.UZOSHOP_META_AD_ACCOUNT_ID = '123';
});
afterEach(() => vi.restoreAllMocks());

describe('fetchMetaAdInsights — reach', () => {
  it('parses reach from the Meta insights row', async () => {
    const { fetchMetaAdInsights } = await import('@/lib/fetchers/meta');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              campaign_id: 'c1', campaign_name: 'C', adset_id: 'as1', adset_name: 'AS',
              ad_id: 'a1', ad_name: 'A', spend: '10', impressions: '1000', clicks: '20',
              reach: '800', actions: [], action_values: [], account_currency: 'ILS',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const rows = await fetchMetaAdInsights('uzoshop', '2026-06-01');
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBe(800);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/metaAdReach.test.ts`
Expected: FAIL — `rows[0].reach` is `undefined` (field not yet parsed).

- [ ] **Step 3: Add `reach` to `MetaAdRow`**

In `src/lib/fetchers/meta.ts`, in `export type MetaAdRow = { … }`, add after `conversionValue: number;`:

```ts
  conversionValue: number;
  /** ad-level daily unique reach (people); null if Meta omits it */
  reach: number | null;
```

- [ ] **Step 4: Request + parse `reach`**

In `fetchMetaAdInsights`, add `'reach',` to the `fields` array (after `'impressions'`):

```ts
    'impressions',
    'reach',
    'clicks',
```

Then in the row loop, add the parse + carry it in the pushed object (after `impressions`):

```ts
      const impressions = parseInt(r.impressions ?? '0', 10) || 0;
      const reach = ((): number | null => {
        const raw = (r as { reach?: string | number }).reach;
        if (raw == null) return null;
        const n = parseInt(String(raw), 10);
        return Number.isFinite(n) ? n : null;
      })();
```

and add `reach,` to the `out.push({ … })` object (after `impressions,`):

```ts
        impressions,
        reach,
        clicks: parseInt(r.clicks ?? '0', 10) || 0,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/metaAdReach.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/fetchers/meta.ts dashboard-web/src/lib/fetchers/__tests__/metaAdReach.test.ts
git commit -m "feat(meta): fetchMetaAdInsights pulls ad-level reach"
```

---

### Task 4: TikTok nightly fetcher pulls `reach`

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/tiktok.ts:69-105` (TikTokAdRow), `:462-560` (fetchTikTokAdInsights)
- Test: `dashboard-web/src/lib/fetchers/__tests__/tiktokAdReach.test.ts`

> Note: `reach` and `frequency` are valid TikTok BASIC `report_type` metrics. We add `reach` to the metrics array and derive frequency downstream. The test drives the parse with a fixture; the live field name is `reach`.

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-web/src/lib/fetchers/__tests__/tiktokAdReach.test.ts
import { describe, it, expect } from 'vitest';
import { parseTikTokAdReach } from '@/lib/fetchers/tiktok';

describe('parseTikTokAdReach', () => {
  it('parses reach from a BASIC report metrics object', () => {
    expect(parseTikTokAdReach({ reach: '650' })).toBe(650);
    expect(parseTikTokAdReach({ reach: 650 })).toBe(650);
  });
  it('returns null when reach is absent', () => {
    expect(parseTikTokAdReach({})).toBeNull();
    expect(parseTikTokAdReach({ reach: undefined })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/tiktokAdReach.test.ts`
Expected: FAIL — `parseTikTokAdReach` is not exported.

- [ ] **Step 3: Add `reach` to `TikTokAdRow` + a tiny exported parser**

In `src/lib/fetchers/tiktok.ts`, in `export type TikTokAdRow = { … }`, add:

```ts
  /** ad-level daily unique reach (people); null if TikTok omits it */
  reach: number | null;
```

Add this exported helper near the other module helpers (top-level, after the imports/types):

```ts
/** Parse TikTok BASIC `metrics.reach` → integer reach, or null when absent. */
export function parseTikTokAdReach(m: Record<string, unknown>): number | null {
  const raw = m.reach;
  if (raw == null) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 4: Request `reach` + carry it through**

In `fetchTikTokAdInsights`, add `reach?: string | number;` to the `AdReportRow.metrics` type (next to `impressions`):

```ts
      impressions?: string | number;
      reach?: string | number;
```

Add `"reach"` to the `metrics` request array (after `"impressions"`):

```ts
        metrics:
          '["spend","impressions","reach","clicks","conversion","complete_payment",' +
          '"value_per_complete_payment",' +
          '"campaign_id","campaign_name","adgroup_id","adgroup_name","ad_name"]',
```

In the row loop (after `const impressions = parseNum(m.impressions);`), compute reach and include it in the pushed row object:

```ts
      const impressions = parseNum(m.impressions);
      const reach = parseTikTokAdReach(m as Record<string, unknown>);
```

Add `reach,` to the object pushed into `out` (alongside `impressions`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dashboard-web && npx vitest run src/lib/fetchers/__tests__/tiktokAdReach.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck (catches the `out.push` shape)**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/lib/fetchers/tiktok.ts dashboard-web/src/lib/fetchers/__tests__/tiktokAdReach.test.ts
git commit -m "feat(tiktok): fetchTikTokAdInsights pulls ad-level reach"
```

---

### Task 5: `cronDaily` writes `reach` for Meta + TikTok ad rows

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts:1305-1354` (Meta ad rows), `:1382-1429` (TikTok ad rows)

> Google ad rows (`:1355-1376`) intentionally omit `reach` (column defaults NULL).

- [ ] **Step 1: Meta ad rows — add `reach` to the local type + payload**

In the `MetaAdRow` local type inside the ads_daily block, add after `conversions: number;`:

```ts
        conversions: number;
        reach: number | null;
        roas: null;
```

In the `metaAdsRows` map, add `reach` to the `row` object (after `conversions: Math.round(r.conversions),`):

```ts
            conversions: Math.round(r.conversions),
            reach: r.reach ?? null,
            roas: null,
```

- [ ] **Step 2: TikTok ad rows — add `reach` to the local type + payload**

In the `TiktokAdRowShape` local type, add after `conversions: number;`:

```ts
        conversions: number;
        reach: number | null;
        roas: null;
```

In the `tiktokAdsRows` map, add `reach` to the `row` object (after `conversions: Math.round(r.conversions),`):

```ts
            conversions: Math.round(r.conversions),
            reach: r.reach ?? null,
            roas: null,
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0. (Confirms `MetaAdRow.reach` / `TikTokAdRow.reach` from Tasks 3-4 line up.)

- [ ] **Step 4: Run the existing cronDaily test suite (no regression)**

Run: `cd dashboard-web && npx vitest run src/inngest/functions/__tests__/`
Expected: PASS (all green; the new `reach` key is additive).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/inngest/functions/cronDaily.ts
git commit -m "feat(cron-daily): persist ad-level reach for Meta + TikTok"
```

---

### Task 6: Detector plumbing — reach in `HalfAgg`, shared helpers, `freqNote`

**Files:**
- Modify: `dashboard-web/src/lib/insights/adFatigue.ts` (whole file restructured below; behavior of `detectAdFatigue` preserved)

This task refactors `detectAdFatigue` to share grouping/half-split helpers (so Task 7 reuses them) and fills the previously-empty `freqNote`. The existing `detectAdFatigue` firing rule is **unchanged**.

- [ ] **Step 1: Run the existing detector tests (capture green baseline)**

Run: `cd dashboard-web && npx vitest run src/lib/insights/__tests__/adFatigue.test.ts`
Expected: PASS (the baseline we must keep green).

- [ ] **Step 2: Add `reach` to `HalfAgg` + `aggregateHalf`**

In `adFatigue.ts`, change the `HalfAgg` type and `aggregateHalf`:

```ts
type HalfAgg = { impr: number; clicks: number; spend: number; reach: number };

function aggregateHalf(rows: AdRow[], dates: Set<string>): HalfAgg {
  const agg: HalfAgg = { impr: 0, clicks: 0, spend: 0, reach: 0 };
  for (const r of rows) {
    if (!dates.has(r.date)) continue;
    agg.impr += r.impressions;
    agg.clicks += r.clicks;
    agg.spend += r.spend;
    agg.reach += r.reach ?? 0;
  }
  return agg;
}
```

- [ ] **Step 3: Extract `groupAds` + `splitHalves` module-private helpers**

Add these helpers (above `detectAdFatigue`), moving the grouping + date-split logic out of the loop:

```ts
function groupAds(ads: AdRow[]): Map<string, AdGroup> {
  const groups = new Map<string, AdGroup>();
  for (const a of ads) {
    const key = `${a.storeId}::${a.platform}::${a.adId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        adId: a.adId, adName: a.adName, campaignId: a.campaignId,
        campaignName: a.campaignName, platform: a.platform,
        storeId: a.storeId, storeName: a.storeName, rows: [],
      };
      groups.set(key, g);
    }
    g.rows.push(a);
  }
  return groups;
}

/** Split an ad's rows into prior/recent half-aggregates, or null if too few
 *  unique dates (>=12 total, >=6 per half). Shared by both fatigue detectors. */
function splitHalves(rows: AdRow[]): { prior: HalfAgg; recent: HalfAgg } | null {
  const uniqueDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  if (uniqueDates.length < 12) return null;
  const midIdx = Math.floor(uniqueDates.length / 2);
  const priorDates = uniqueDates.slice(0, midIdx);
  const recentDates = uniqueDates.slice(midIdx);
  if (priorDates.length < 6 || recentDates.length < 6) return null;
  return {
    prior: aggregateHalf(rows, new Set(priorDates)),
    recent: aggregateHalf(rows, new Set(recentDates)),
  };
}
```

- [ ] **Step 4: Rewrite `detectAdFatigue` to use the helpers + fill `freqNote`**

Replace the body of `detectAdFatigue` with:

```ts
export function detectAdFatigue(ads: AdRow[]): Insight[] {
  const insights: Insight[] = [];
  for (const g of groupAds(ads).values()) {
    const halves = splitHalves(g.rows);
    if (!halves) continue;
    const { prior, recent } = halves;
    if (prior.impr + recent.impr < 5000) continue;
    if (prior.impr <= 0 || recent.impr <= 0) continue;
    const priorCtr = prior.clicks / prior.impr;
    const recentCtr = recent.clicks / recent.impr;
    const priorCpm = (prior.spend / prior.impr) * 1000;
    const recentCpm = (recent.spend / recent.impr) * 1000;
    if (priorCtr <= 0 || priorCpm <= 0) continue;

    const ctrFatigued = recentCtr <= 0.7 * priorCtr;
    const cpmRising = recentCpm >= 1.2 * priorCpm;
    if (!ctrFatigued || !cpmRising) continue;

    const ctrDropPct = Math.round((1 - recentCtr / priorCtr) * 100);
    const cpmRisePct = Math.round((recentCpm / priorCpm - 1) * 100);

    // Frequency note — populated only when reach is present on both halves
    // (Meta/TikTok). Relative trend, never an absolute weekly-frequency claim.
    let freqNote = '';
    if (prior.reach > 0 && recent.reach > 0) {
      const priorFreq = prior.impr / prior.reach;
      const recentFreq = recent.impr / recent.reach;
      if (priorFreq > 0 && recentFreq > priorFreq) {
        freqNote = ` התדירות עלתה ${Math.round((recentFreq / priorFreq - 1) * 100)}%.`;
      }
    }

    insights.push({
      id: `fatigue-${g.adId}`,
      severity: 'opportunity',
      kind: 'recommendation',
      scope: `${g.platform} · ${g.storeName ?? ''}`,
      title: `עייפות קריאייטיב: ${g.adName || 'מודעה'}`,
      detail: `CTR ירד ${ctrDropPct}% ו-CPM עלה ${cpmRisePct}% בחצי האחרון. שקול לרענן קריאייטיב.${freqNote}`,
      why: `CTR ${(priorCtr * 100).toFixed(2)}%→${(recentCtr * 100).toFixed(2)}%, CPM ${fmtMoneyString(priorCpm)}→${fmtMoneyString(recentCpm)} (חציון לחצי).`,
      href: adsManagerLink(g.platform, g.campaignId) ?? undefined,
      weight: 68,
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      platform: g.platform as Insight['platform'],
      storeId: g.storeId,
      storeName: g.storeName,
    });
  }
  return insights;
}
```

- [ ] **Step 5: Verify existing detector tests still pass (behavior preserved)**

Run: `cd dashboard-web && npx vitest run src/lib/insights/__tests__/adFatigue.test.ts`
Expected: PASS — unchanged (fixtures carry no `reach`, so `freqNote` stays `''` and the rule is identical).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/insights/adFatigue.ts
git commit -m "refactor(fatigue): share group/half helpers; fill freqNote when reach present"
```

---

### Task 7: New `detectAdFatigueEarlyWarning`

**Files:**
- Modify: `dashboard-web/src/lib/insights/adFatigue.ts` (add exported function + constants)
- Test: `dashboard-web/src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard-web/src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts
import { describe, it, expect } from 'vitest';
import { detectAdFatigueEarlyWarning } from '@/lib/insights/adFatigue';
import type { AdRow } from '@/lib/ads';

// Build N day-rows for one ad. impr/clicks/spend/reach are PER DAY.
function adDays(
  over: Partial<AdRow>,
  days: number,
  per: { impr: number; clicks: number; spend: number; reach: number },
): AdRow[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta',
    campaignId: 'c1', campaignName: 'C', adSetId: 'as1', adSetName: 'AS',
    adId: 'a1', adName: 'Creative A',
    spend: per.spend, impressions: per.impr, clicks: per.clicks, conversions: 1,
    conversionValue: 0, reach: per.reach,
    regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
    regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
    ...over,
  }));
}

const ewIds = (out: ReturnType<typeof detectAdFatigueEarlyWarning>) =>
  out.filter((i) => i.id.startsWith('ew-fatigue-')).map((i) => i.id);

describe('detectAdFatigueEarlyWarning', () => {
  it('fires when frequency climbs >=20% with healthy CTR/CPM (no strong rule)', () => {
    // prior 6 days: freq = 1000/800 = 1.25 ; recent 6 days: freq = 1300/800 = 1.625 (+30%)
    // CTR flat, CPM flat → strong rule does NOT fire.
    const prior = adDays({}, 6, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    const recent = adDays({}, 6, { impr: 1300, clicks: 26, spend: 6.5, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}` }),
    );
    const out = detectAdFatigueEarlyWarning([...prior, ...recent]);
    expect(ewIds(out)).toContain('ew-fatigue-a1');
  });

  it('is suppressed when the strong CTR-down + CPM-up rule already fires', () => {
    // recent: CTR halves AND CPM doubles AND freq climbs → strong rule owns it.
    const prior = adDays({}, 6, { impr: 1000, clicks: 40, spend: 5, reach: 800 });
    const recent = adDays({}, 6, { impr: 1300, clicks: 13, spend: 13, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}` }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });

  it('skips ads with no reach (Google-blind)', () => {
    const prior = adDays({ reach: null }, 6, { impr: 1000, clicks: 20, spend: 5, reach: 0 });
    const recent = adDays({ reach: null }, 6, { impr: 1300, clicks: 26, spend: 6.5, reach: 0 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 7).padStart(2, '0')}`, reach: null }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });

  it('does not fire on flat frequency', () => {
    const all = adDays({}, 12, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    expect(ewIds(detectAdFatigueEarlyWarning(all))).toHaveLength(0);
  });

  it('respects the >=12 unique-dates floor', () => {
    const prior = adDays({}, 5, { impr: 1000, clicks: 20, spend: 5, reach: 800 });
    const recent = adDays({}, 5, { impr: 1300, clicks: 26, spend: 6.5, reach: 800 }).map(
      (r, i) => ({ ...r, date: `2026-05-${String(i + 6).padStart(2, '0')}` }),
    );
    expect(ewIds(detectAdFatigueEarlyWarning([...prior, ...recent]))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dashboard-web && npx vitest run src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts`
Expected: FAIL — `detectAdFatigueEarlyWarning` is not exported.

- [ ] **Step 3: Implement the early-warning detector**

In `adFatigue.ts`, add the constants near the top (after imports) and the function (after `detectAdFatigue`):

```ts
/** Early-warning frequency thresholds (tunable). */
const EW_FREQ_CLIMB = 1.2; // recent half-frequency >= 1.2x prior (>=20% climb)
const EW_FREQ_FLOOR = 1.3; // recent half-frequency must clear this absolute floor
```

```ts
/**
 * Earlier, softer creative-fatigue signal: fires when an ad's impression
 * frequency (impressions / reach) is climbing — the same people are being
 * shown the creative more often — BEFORE CTR craters and CPM climbs. Suppressed
 * when the strong `detectAdFatigue` rule already fires for the ad (no
 * double-surface). Meta + TikTok only (Google rows have null reach → skipped).
 * Frequency here is a RELATIVE trend (reach is not additive across days; the
 * same bias applies to both halves so the recent/prior ratio stays valid).
 */
export function detectAdFatigueEarlyWarning(ads: AdRow[]): Insight[] {
  const insights: Insight[] = [];
  for (const g of groupAds(ads).values()) {
    const halves = splitHalves(g.rows);
    if (!halves) continue;
    const { prior, recent } = halves;
    if (prior.impr + recent.impr < 5000) continue;
    if (prior.impr <= 0 || recent.impr <= 0) continue;
    // Reach required on both halves — Google (null reach) is skipped here.
    if (prior.reach <= 0 || recent.reach <= 0) continue;

    const priorFreq = prior.impr / prior.reach;
    const recentFreq = recent.impr / recent.reach;
    if (priorFreq <= 0) continue;

    // Suppress when the strong rule owns this ad.
    const priorCtr = prior.clicks / prior.impr;
    const recentCtr = recent.clicks / recent.impr;
    const priorCpm = (prior.spend / prior.impr) * 1000;
    const recentCpm = (recent.spend / recent.impr) * 1000;
    const strongFires =
      priorCtr > 0 && priorCpm > 0 &&
      recentCtr <= 0.7 * priorCtr && recentCpm >= 1.2 * priorCpm;
    if (strongFires) continue;

    if (recentFreq < EW_FREQ_CLIMB * priorFreq) continue;
    if (recentFreq < EW_FREQ_FLOOR) continue;

    const climbPct = Math.round((recentFreq / priorFreq - 1) * 100);
    insights.push({
      id: `ew-fatigue-${g.adId}`,
      severity: 'opportunity',
      kind: 'recommendation',
      scope: `${g.platform} · ${g.storeName ?? ''}`,
      title: `אזהרה מוקדמת — שחיקה מתקרבת: ${g.adName || 'מודעה'}`,
      detail: `התדירות עלתה ${climbPct}% — אותם אנשים רואים את המודעה יותר ויותר. שקול לרענן קריאייטיב לפני שהביצועים נפגעים.`,
      why: `תדירות ${priorFreq.toFixed(2)}→${recentFreq.toFixed(2)} (חשיפות לאדם, מגמה יחסית — לא תדירות שבועית מוחלטת).`,
      href: adsManagerLink(g.platform, g.campaignId) ?? undefined,
      weight: 52, // below the strong rule's 68 so it ranks under it
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      platform: g.platform as Insight['platform'],
      storeId: g.storeId,
      storeName: g.storeName,
    });
  }
  return insights;
}
```

- [ ] **Step 4: Run the early-warning tests to verify they pass**

Run: `cd dashboard-web && npx vitest run src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Run the existing detector tests (still green)**

Run: `cd dashboard-web && npx vitest run src/lib/insights/__tests__/adFatigue.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/insights/adFatigue.ts dashboard-web/src/lib/insights/__tests__/adFatigueEarlyWarning.test.ts
git commit -m "feat(fatigue): detectAdFatigueEarlyWarning — frequency-climb early warning"
```

---

### Task 8: Wire the early-warning into the insights pipeline

**Files:**
- Modify: `dashboard-web/src/lib/insights.ts:45` (import), `:884-885` (call + concat)

- [ ] **Step 1: Import the new detector**

In `src/lib/insights.ts`, change the adFatigue import line (currently `import { detectAdFatigue } from './insights/adFatigue';`) to:

```ts
import { detectAdFatigue, detectAdFatigueEarlyWarning } from './insights/adFatigue';
```

- [ ] **Step 2: Call it + concat into the result**

Change the fatigue block (`:884-885`) to:

```ts
  const fatigue = detectAdFatigue(ads);
  const fatigueEarly = detectAdFatigueEarlyWarning(ads);
  return [...anomalies, ...recs, ...died, ...fatigue, ...fatigueEarly].sort((a, b) => b.weight - a.weight);
```

- [ ] **Step 3: Typecheck + run the insights test suite**

Run: `cd dashboard-web && npx tsc --noEmit && npx vitest run src/lib/__tests__/ src/lib/insights/__tests__/`
Expected: exit 0 + PASS.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/insights.ts
git commit -m "feat(insights): surface creative-fatigue early-warning in the board"
```

---

### Task 9: Backfill script — Meta + TikTok reach over history

**Files:**
- Create: `dashboard-web/scripts/backfillAdsReach.ts`

Reuses the now-reach-enabled `fetchMetaAdInsights` / `fetchTikTokAdInsights`, then UPDATEs `ads_daily.reach` keyed on (date, store_id, ad_id). Read-only toward platforms; writes only `reach`. Re-runnable. DRY_RUN prints counts only.

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env node
// dashboard-web/scripts/backfillAdsReach.ts
//
// One-off / re-runnable: populate ads_daily.reach (Meta + TikTok) over history
// so the creative-fatigue early-warning has frequency data immediately (not just
// going forward). Reuses the nightly ad fetchers (which now return `reach`) and
// UPDATEs the reach column keyed on (date, store_id, ad_id). Read-only toward
// the ad platforms; ZERO writes to pixels/CAPI. Google is skipped (no frequency).
//
// RUN (from repo root):
//   cd /Users/dorperetz/script-roas
//   export SUPABASE_URL="$(grep -E '^supabase\.url ?=' .env | cut -d= -f2- | xargs)"
//   export SUPABASE_SERVICE_ROLE_KEY="$(grep -E '^supabase\.service\.role\.key ?=' .env | cut -d= -f2- | xargs)"
//   # plus each store's META/TIKTOK creds the fetchers read from process.env
//   # (UZOSHOP_META_ACCESS_TOKEN, UZOSHOP_META_AD_ACCOUNT_ID, UZOSHOP_TIKTOK_* …)
//   DRY_RUN=1 FROM=2026-05-01 TO=2026-06-05 npx tsx dashboard-web/scripts/backfillAdsReach.ts
//   FROM=2026-05-01 TO=2026-06-05 npx tsx dashboard-web/scripts/backfillAdsReach.ts
import { createClient } from '@supabase/supabase-js';
import { fetchMetaAdInsights } from '../src/lib/fetchers/meta';
import { fetchTikTokAdInsights } from '../src/lib/fetchers/tiktok';

const STORES = ['uzoshop', 'zolplus', 'usmile360'];
const TT_STORES = ['uzoshop']; // only uzoshop has a TikTok account
const DRY = process.env.DRY_RUN === '1';

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required');
  const from = process.env.FROM ?? '2026-05-01';
  const to = process.env.TO ?? new Date().toISOString().slice(0, 10);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let updated = 0;
  for (const date of eachDate(from, to)) {
    for (const storeId of STORES) {
      const metaRows = await fetchMetaAdInsights(storeId, date).catch((e) => {
        console.warn(`meta ${storeId} ${date}: ${(e as Error).message}`); return [];
      });
      for (const r of metaRows) {
        if (r.reach == null) continue;
        if (DRY) { updated++; continue; }
        const { error } = await sb.from('ads_daily').update({ reach: r.reach })
          .eq('date', date).eq('store_id', storeId).eq('ad_id', r.adId).eq('platform', 'meta');
        if (error) console.warn(`upd meta ${storeId} ${date} ${r.adId}: ${error.message}`);
        else updated++;
      }
    }
    for (const storeId of TT_STORES) {
      const ttRows = await fetchTikTokAdInsights(storeId, date).catch((e) => {
        console.warn(`tiktok ${storeId} ${date}: ${(e as Error).message}`); return [];
      });
      for (const r of ttRows) {
        if (r.reach == null) continue;
        const target = r.storeId ?? storeId; // honor campaign-store-map
        if (DRY) { updated++; continue; }
        const { error } = await sb.from('ads_daily').update({ reach: r.reach })
          .eq('date', date).eq('store_id', target).eq('ad_id', r.adId).eq('platform', 'tiktok');
        if (error) console.warn(`upd tt ${target} ${date} ${r.adId}: ${error.message}`);
        else updated++;
      }
    }
    console.log(`${date} — running total reach rows ${DRY ? 'matched' : 'updated'}: ${updated}`);
  }
  console.log(`\nDONE — ${updated} rows ${DRY ? 'would be updated (DRY_RUN)' : 'updated'}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck the script**

Run: `cd dashboard-web && npx tsc --noEmit`
Expected: exit 0. (Do NOT run the script yet — it needs the migration applied + live creds; run in Task 10 after the migration lands.)

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/scripts/backfillAdsReach.ts
git commit -m "feat(backfill): one-off ads_daily.reach backfill (Meta + TikTok)"
```

---

### Task 10: Docs, full gate, apply migration + backfill, deploy

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (version box + changelog)
- Modify: `docs/ARCHITECTURE.md` (reach column + early-warning + backfill)

- [ ] **Step 1: User Manual — bump version + changelog**

Bump the version-box number to the next patch (e.g. `2.43.4` → `2.43.5`; use whatever the current value is +1 patch) and add a new top changelog block in the existing `## מה התחדש (…)` style:

```markdown
## מה התחדש (2026-06-05 · אזהרה מוקדמת לשחיקת קריאייטיב (תדירות) · <VERSION>)

נוספה תובנה חדשה ורכה בלוח-התובנות: **"אזהרה מוקדמת — שחיקה מתקרבת"**. היא נדלקת כשמודעה מתחילה להגיע שוב ושוב לאותם אנשים (התדירות מטפסת ב-20%+) — **עוד לפני** שה-CTR צונח וה-CPM מזנק, כך שאפשר לרענן קריאייטיב בזמן. עובדת ל-Meta ו-TikTok (ל-Google אין מדד תדירות). התובנה החזקה הקיימת (CTR יורד + CPM עולה) נשארת ללא שינוי; אם היא כבר נדלקה למודעה — לא תוצג גם אזהרה מוקדמת לאותה מודעה. המספר הוא מגמה יחסית, לא "תדירות שבועית" מוחלטת.
```

(Replace `<VERSION>` with the bumped number in BOTH the box and this heading.)

- [ ] **Step 2: ARCHITECTURE — note the data + detector change**

Append to the relevant section (ads_daily schema / insights engine):

```markdown
- **ads_daily.reach** (BIGINT, nullable; migration `20260605130000`): ad-level daily unique reach. Populated by `fetchMetaAdInsights` + `fetchTikTokAdInsights` and written nightly by `cronDaily` (Google omits it — no per-user frequency). Surfaced via the rebuilt `ads_enriched` view (`a.*`). One-off history fill: `scripts/backfillAdsReach.ts`.
- **Creative-fatigue early warning** (`detectAdFatigueEarlyWarning`, `lib/insights/adFatigue.ts`): fires when impression frequency (impressions ÷ reach) climbs ≥20% with a recent floor, suppressed when the strong CTR↓+CPM↑ rule fires. Relative trend only (reach is not additive across days).
```

- [ ] **Step 3: Full local gate**

Run:
```bash
cd dashboard-web && npx tsc --noEmit && npm run test && npm run test:components && npm run lint
```
Expected: tsc exit 0; both vitest suites green; lint 0 errors.

- [ ] **Step 4: Apply the migration (operator-gated)**

Per `reference-supabase-migration-procedure`: hide root `.env`, move the 2 duplicate-timestamp gap files (`20260530300000_phase_d_soak_cleanup` + `20260530310000`) out of `supabase/migrations/`, then:
```bash
cd /Users/dorperetz/script-roas && npx supabase db push
```
Restore the moved files + `.env` afterward. Verify: `reach` column exists on `ads_daily` and `SELECT reach FROM ads_enriched LIMIT 1;` succeeds.

- [ ] **Step 5: Run the backfill**

```bash
cd /Users/dorperetz/script-roas
# export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY + store creds (see script header)
DRY_RUN=1 FROM=2026-05-01 npx tsx dashboard-web/scripts/backfillAdsReach.ts   # sanity
FROM=2026-05-01 npx tsx dashboard-web/scripts/backfillAdsReach.ts             # real
```
Expected: DONE line with a non-zero updated count. Spot-check: `SELECT count(*) FROM ads_daily WHERE reach IS NOT NULL AND platform IN ('meta','tiktok');` > 0.

- [ ] **Step 6: Commit docs + push**

```bash
git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md
git commit -m "docs: creative-fatigue early-warning (frequency leg) + ads_daily.reach"
git push origin main
```
Expected: pre-push gates pass (tsc/vitest/docs-currency); Vercel builds. Operator live-verifies the new insight appears for an ad with climbing frequency.

---

## Self-Review

**Spec coverage:**
- §3.1 data layer → Tasks 1 (migration+view), 2 (reader+type), 3 (Meta), 4 (TikTok), 5 (cronDaily). ✓
- §3.2 backfill → Task 9 + Task 10 Step 5. ✓
- §3.3 detector (early-warning + freqNote + wiring) → Tasks 6, 7, 8. ✓
- §4 thresholds (1.2 climb / 1.3 floor / suppression / reuse gates) → Task 7 constants + logic. ✓
- §5 Meta+TikTok / Google-blind → Tasks 3/4/5 (Google omitted), Task 7 (null-reach skipped) + test. ✓
- §6 relative-trend honesty → Task 7 `why` copy + Task 6 freqNote copy. ✓
- §7 testing → Tasks 3,4,7 tests + Task 10 gate. ✓
- §8 risk: ads_enriched view → Task 1 DROP/CREATE. ✓

**Placeholder scan:** `<VERSION>` in Task 10 is an intentional operator-fills-current-number token with explicit instructions; all code blocks are complete. No TBD/TODO. ✓

**Type consistency:** `reach: number | null` on `MetaAdRow`/`TikTokAdRow` (Tasks 3/4) consumed by `cronDaily` `r.reach ?? null` (Task 5); `AdRow.reach?: number | null` (Task 2) consumed by `HalfAgg.reach` via `r.reach ?? 0` (Task 6); `groupAds`/`splitHalves`/`HalfAgg`/`aggregateHalf` names consistent across Tasks 6-7; `detectAdFatigueEarlyWarning` exported (Task 7) and imported (Task 8) identically. ✓

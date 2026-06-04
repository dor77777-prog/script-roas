> ⚠️ **PARTIALLY DESCOPED — operator 2026-06-04.** BUILD ONLY the 3 IN-APP features: `native-prioritized-action-list`, `campaign-died-detection`, `creative-ad-fatigue-signal` (surface them in the in-app insights board, NOT WhatsApp). **Do NOT build** the WhatsApp-push features: `push-insights-digest`, `break-even-flag-digest`, `day-over-day-deltas-digest`, `goal-pacing-alert-push`. The EXISTING WhatsApp alerts (token-failure + the `roas_daily_summary` at 12:00/18:00/00:10 IL) stay UNCHANGED — add nothing to them.

# Alerts & Action Digest (Push the Intelligence) Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Stop the dashboard's intelligence from being trapped behind a pull-based, collapsed-by-default in-app panel. Push the existing `lib/insights.ts` rule engine (scale / pause / zero-conversion / rebalance / anomalies / pacing / forecast) to WhatsApp as a daily/weekly **action digest**, add **break-even verdicts** and **day-over-day deltas** to the pushed message, fire a proactive **goal-pacing alert** when the business falls behind, detect **campaigns that went dark** (was-spending-now-zero), detect **creative/ad fatigue** (frequency climb + CTR decay + CPM creep at the ad level), and add a native **"do this today" prioritized action list** surface in-app (no external-LLM round-trip). All of this rides the existing notification plumbing (`lib/notifications/*`, the approved `roas_daily_summary` 5-param Meta template, `notifyTokenFailure`'s throttle pattern, the `whatsappCronFunctions` cron registration) so we add value without rebuilding the pipe.

Architecture: Pure analytics in `lib/insights/*` and `lib/notifications/*` (no React, deterministic, fully unit-tested with the node vitest config). A single new cron function (`cron-action-digest`) reads `data_daily` / `campaigns_daily` / `products_daily` / `dashboard_state` server-side via the existing `postgresReaders` + `loadActiveMetacloudConfig`, runs the rule engine, and pushes a free-form digest text (copy-only items ride the existing approved template body; the prioritized free-text digest needs a **new** `roas_action_digest` template). The fatigue detector reads existing `ads_daily` columns (impressions / clicks / spend) for CTR decay + CPM creep, with an **optional** nullable `frequency` column added to `ads_daily` (migration) + the Meta ad-insights fetcher for the frequency-climb leg. The campaign-died detector is a new branch in the existing anomaly engine fed by the rolling `campaigns_daily` history. The native action list reuses `Insight[]` from `buildAllInsights` plus a new cross-insight dedup+rank layer (`lib/insights/prioritize.ts`) consumed by both the new in-app `ActionListPanel` and the WhatsApp digest builder.

Tech Stack: Next.js 14 (App Router) + TypeScript, Inngest cron functions, Supabase Postgres, Meta WhatsApp Cloud API (v25.0 template messages), vitest (node default config `vitest.config.ts` + DOM config `vitest.config.dom.ts`), Tailwind token-driven UI (light + dark, RTL/logical classes, `<Money>`/`<Metric>` primitives, `HelpTooltip`), eslint guards (`local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, design-color green-ratchet).

---

## File Structure

### New files (one responsibility each)
- `dashboard-web/src/lib/insights/prioritize.ts` — cross-insight dedup + rank → `prioritizeInsights(insights, n)` returns the top-N deduped "do this today" list. Pure.
- `dashboard-web/src/lib/insights/__tests__/prioritize.test.ts` — unit tests for `prioritizeInsights`.
- `dashboard-web/src/lib/insights/campaignDied.ts` — `detectCampaignsWentDark(campaigns)` → `Insight[]` for active winners that silently dropped to $0. Pure.
- `dashboard-web/src/lib/insights/__tests__/campaignDied.test.ts` — unit tests.
- `dashboard-web/src/lib/insights/adFatigue.ts` — `detectAdFatigue(ads)` → `Insight[]` (frequency climb + CTR decay + CPM creep at the ad level). Pure.
- `dashboard-web/src/lib/insights/__tests__/adFatigue.test.ts` — unit tests.
- `dashboard-web/src/lib/notifications/digestSummary.ts` — `buildDigestData(today, baselineDays)` server-side reader: loads rows + runs the engine + computes day-over-day deltas + break-even verdicts. Returns a plain JSON shape.
- `dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts` — unit tests (mocked Supabase).
- `dashboard-web/src/lib/notifications/digestMessage.ts` — `buildDigestMessageParams(digest)` → the WhatsApp template parameter array (free-form, sanitized, Meta-safe). Pure.
- `dashboard-web/src/lib/notifications/__tests__/digestMessage.test.ts` — unit tests.
- `dashboard-web/src/lib/notifications/sendActionDigest.ts` — `sendActionDigest(opts)` orchestrator: load config + build digest + send via `sendWhatsAppTemplate`. Mirrors `sendDailySummary.ts`.
- `dashboard-web/src/lib/notifications/__tests__/sendActionDigest.test.ts` — orchestrator tests (mocked whatsapp + digest).
- `dashboard-web/src/lib/notifications/breakEven.ts` — `roasVerdict(roas)` + `formatRoasVerdict(roas)` — single source of truth for the break-even/band verdict used in the digest. Pure.
- `dashboard-web/src/lib/notifications/__tests__/breakEven.test.ts` — unit tests.
- `dashboard-web/src/inngest/functions/cronActionDigest.ts` — the digest cron (daily) + `eventActionDigestSendNow` (operator "send now") + `actionDigestFunctions` export array.
- `dashboard-web/src/inngest/functions/__tests__/cronActionDigest.test.ts` — cron-handler tests (mocked sender).
- `dashboard-web/src/components/insights/ActionListPanel.tsx` — in-app "do this today" top-N ranked surface (token-driven, light+dark, RTL, `<Money>` numbers, `HelpTooltip`).
- `dashboard-web/src/components/insights/__tests__/ActionListPanel.test.tsx` — DOM test (vitest.config.dom.ts).
- `supabase/migrations/20260604120000_add_ads_daily_frequency.sql` — `ALTER TABLE ads_daily ADD COLUMN IF NOT EXISTS frequency NUMERIC(10,4)` (nullable). Repo-root migration.

### Modified files
- `dashboard-web/src/lib/insights.ts` — export the existing `buildAllInsights` ingredients so the digest can reuse them; add `detectCampaignsWentDark` + `detectAdFatigue` into `buildAllInsights` (campaign-died + fatigue become first-class insights).
- `dashboard-web/src/lib/fetchers/meta.ts` — add `frequency` to the ad-level insights field list + wire type + return shape (optional, nullable).
- `dashboard-web/src/inngest/functions/cronDaily.ts` — write `frequency` into the `ads_daily` UPSERT (the Meta ad writer).
- `dashboard-web/src/lib/postgresReaders.ts` — read `frequency` from `ads_enriched`/`ads_daily` into `AdRow`.
- `dashboard-web/src/lib/ads.ts` — add `frequency: number | null` to the `AdRow` type.
- `dashboard-web/src/app/api/inngest/route.ts` — register `actionDigestFunctions` + `eventActionDigestSendNow` in `serve()`.
- `dashboard-web/src/components/InsightsBoard.tsx` — mount `ActionListPanel` above the collapsed board (always-visible top-N, board stays collapsed for the long tail).
- `docs/ROAS-Dashboard-User-Manual.md` — document the WhatsApp action digest, the in-app action list, break-even verdicts, fatigue + campaign-died alerts (UI/feature change → User Manual gate).
- `docs/ARCHITECTURE.md` — document the new cron, the `frequency` column + migration, the digest data path (lib/inngest/migration change → Architecture gate).

### Migration apply procedure (used by the one migration in this plan)
Documented in MEMORY `[Supabase migration procedure]`:
1. Temporarily hide the root `.env` (dotted keys break the CLI parser): `mv /Users/dorperetz/script-roas/.env /Users/dorperetz/script-roas/.env.hidden`
2. Move the 2 duplicate-timestamp gap files out so `db push` doesn't fail on duplicate-key:
   `mv /Users/dorperetz/script-roas/supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql /tmp/` and
   `mv /Users/dorperetz/script-roas/supabase/migrations/20260530310000_agg_data_daily_for_date.sql /tmp/`
3. `supabase db push` (applies only-new migrations).
4. Restore all three files (`mv` back).
Re-backfill note: `frequency` is purely additive and nullable. No backfill is required — historical `ads_daily` rows keep `frequency = NULL` and the fatigue detector's frequency leg simply no-ops on null. Forward fill happens automatically from the next `cron-daily` Meta ad write. (Optional later: an operator-triggered `eventBackfill` over a recent window will populate frequency for those days.)

---

## Cross-cutting constraints (apply to EVERY task)
- **CAPI-safe / read-only**: this entire workstream only READS data and SENDS WhatsApp/renders UI. It never sends events to any pixel/CAPI. No Triple-Pixel / Sonar / multi-touch / first-touch-via-pixel. ✅ CAPI-safe by construction.
- **Mapping-aware aggregates only**: server-side digest reads `data_daily` (already mapping-aware via the `agg_data_daily_for_date` + `campaignStoreMap` write path) and per-store buckets — never raw account totals. Campaign/ad detectors read `campaigns_daily`/`ads_daily` which are already mapping-resolved by the writers.
- **ROAS bands are fixed** (MEMORY `[ROAS bands 2x/3x = correct break-even]`): `<2x red`, `2–2.7x orange`, `3x target green`. The break-even feature reuses `roasLabel`'s thresholds (`lib/analytics.ts:448`) — it does NOT introduce a new CM%-derived break-even number, and VAT=0 (no tax-out-of-revenue). See Open Questions Q1.
- **UI tasks** (Feature G) follow the mandatory mockup-first rule (Task G1), then token-driven + light/dark + RTL + `<Money>` + `HelpTooltip` + pass the lint/readability guards.
- **Gates before any push** (the worker runs these after the feature is complete, before the single deploy): `npx tsc --noEmit`, `npm run test`, `npm run test:components`, `npm run lint`, and the docs-currency pre-push gate (User Manual + Architecture updated). No drip-deploy (MEMORY `[No drip-deploy]`): finish all features, verify locally both themes, then ONE `git push origin main`.
- **Per-task commits**: each task ends with a real `git commit`. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Feature: break-even-flag-digest
**Gap id:** `break-even-flag-digest` · **Impact:** high · **Effort:** S · **CAPI-safe:** yes · **Template:** copy-only (rides existing `roas_daily_summary` body) · **Dependencies:** none. Foundation for `push-insights-digest` (the digest message reuses `roasVerdict`).

The daily WhatsApp digest prints raw ROAS per store (`templateParams.ts:storeBlock`) but never flags when a store is below its profitability floor. `lib/notifications/` has zero break-even/band logic. We add a single-source-of-truth verdict helper keyed on the EXISTING fixed ROAS bands and surface the verdict inline so `ROAS: 2.10` reads `ROAS: 2.10 ⚠ מתחת ליעד`.

### Task 1 — `roasVerdict` + `formatRoasVerdict` helper (band-driven, single source of truth)
- [ ] Write failing test `dashboard-web/src/lib/notifications/__tests__/breakEven.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { roasVerdict, formatRoasVerdict } from '../breakEven';

  describe('roasVerdict — keyed on the fixed ROAS bands (2x / 2.7x / 3x)', () => {
    it('classifies below-floor (<2x) as critical "below break-even"', () => {
      const v = roasVerdict(1.4);
      expect(v.band).toBe('red');
      expect(v.belowTarget).toBe(true);
    });
    it('classifies 2–2.7x as warning (above floor, below target)', () => {
      const v = roasVerdict(2.3);
      expect(v.band).toBe('orange');
      expect(v.belowTarget).toBe(true);
    });
    it('classifies >=3x as at/above target', () => {
      const v = roasVerdict(3.4);
      expect(v.band).toBe('blue');
      expect(v.belowTarget).toBe(false);
    });
    it('treats 0 / non-finite as no-data (no false alarm)', () => {
      expect(roasVerdict(0).band).toBe('gray');
      expect(roasVerdict(Number.NaN).belowTarget).toBe(false);
    });
  });

  describe('formatRoasVerdict — Meta-safe single-line Hebrew suffix', () => {
    it('appends a warning marker for below-target ROAS', () => {
      const s = formatRoasVerdict(1.4);
      expect(s).toContain('⚠');
      expect(s).not.toMatch(/[\n\t]/);
    });
    it('returns an empty suffix for at-target ROAS (no clutter)', () => {
      expect(formatRoasVerdict(3.4)).toBe('');
    });
    it('returns an empty suffix for no-data ROAS', () => {
      expect(formatRoasVerdict(0)).toBe('');
    });
  });
  ```
- [ ] Run it (expect FAIL — module missing): `npm run test -- src/lib/notifications/__tests__/breakEven.test.ts`
- [ ] Minimal impl `dashboard-web/src/lib/notifications/breakEven.ts`:
  ```ts
  // Break-even / below-target ROAS verdict for the pushed digest.
  //
  // Single source of truth: this REUSES the fixed dashboard ROAS bands
  // (<2x red, 2–2.7x orange, 3x target green/blue — lib/analytics.ts:roasLabel
  // + MEMORY [ROAS bands 2x/3x = correct break-even]). We deliberately do NOT
  // introduce a separate CM%-derived break-even number: the operator locked
  // the 3x target as the profitability floor and VAT=0 (cross-border).
  import { roasLabel } from '@/lib/analytics';

  export type RoasBand = 'red' | 'orange' | 'green' | 'blue' | 'gray';

  export function roasVerdict(roas: number): {
    band: RoasBand;
    /** true when ROAS is below the 3x internal target (red or orange). */
    belowTarget: boolean;
    /** true when ROAS is below the 2x floor (red) — the hard alarm. */
    belowFloor: boolean;
  } {
    const { tone } = roasLabel(roas);
    const hasData = Number.isFinite(roas) && roas > 0;
    return {
      band: tone,
      belowTarget: hasData && (tone === 'red' || tone === 'orange'),
      belowFloor: hasData && tone === 'red',
    };
  }

  /** Meta-safe single-line Hebrew suffix appended after a ROAS figure in the
   *  digest. Empty string when at/above target or no data (keeps the line clean). */
  export function formatRoasVerdict(roas: number): string {
    const v = roasVerdict(roas);
    if (!v.belowTarget) return '';
    return v.belowFloor ? ' ⚠ מתחת לסף רווחיות' : ' ⚠ מתחת ליעד';
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/breakEven.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/breakEven.ts dashboard-web/src/lib/notifications/__tests__/breakEven.test.ts && git commit -m "feat(digest): band-driven break-even ROAS verdict helper (gap break-even-flag-digest)"`

---

## Feature: day-over-day-deltas-digest
**Gap id:** `day-over-day-deltas-digest` · **Impact:** medium · **Effort:** S · **CAPI-safe:** yes · **Template:** copy-only (lands inside the free-form digest, Feature push-insights-digest) · **Dependencies:** Feature break-even-flag-digest (verdict helper). Consumed by `push-insights-digest`.

`lib/notifications/summary.ts` builds a single-date snapshot and never compares to yesterday / a trailing baseline. `deltaPct` exists in `lib/analytics.ts:456` but never reaches the push path. We add a delta computation against a trailing baseline so the digest carries "what CHANGED", not just today's level.

### Task 2 — `computeDigestDeltas` against a trailing baseline
- [ ] Write failing test `dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts` (delta-only block first; the reader block is added in Task 6):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { computeDigestDeltas } from '../digestSummary';

  describe('computeDigestDeltas — today vs trailing-baseline mean', () => {
    it('flags revenue down vs the prior-days mean', () => {
      const d = computeDigestDeltas(
        { revenue: 800, spend: 400, roas: 2 },
        [
          { revenue: 1000, spend: 400, roas: 2.5 },
          { revenue: 1000, spend: 400, roas: 2.5 },
        ],
      );
      expect(d.revenue.direction).toBe('down');
      expect(Math.round(d.revenue.value * 100)).toBe(-20); // -20%
    });
    it('returns flat with empty baseline (no false delta)', () => {
      const d = computeDigestDeltas({ revenue: 800, spend: 400, roas: 2 }, []);
      expect(d.revenue.direction).toBe('flat');
      expect(d.spend.direction).toBe('flat');
      expect(d.roas.direction).toBe('flat');
    });
    it('flags spend up vs baseline', () => {
      const d = computeDigestDeltas(
        { revenue: 1000, spend: 600, roas: 1.6 },
        [{ revenue: 1000, spend: 400, roas: 2.5 }],
      );
      expect(d.spend.direction).toBe('up');
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts`
- [ ] Minimal impl — create `dashboard-web/src/lib/notifications/digestSummary.ts` with ONLY the delta helper for now (the Supabase reader `buildDigestData` arrives in Task 6):
  ```ts
  // Digest data builder — runs the insights engine + day-over-day deltas +
  // break-even verdicts server-side for the pushed action digest.
  // Pure delta helper here; the Supabase reader (buildDigestData) is added
  // in the push-insights-digest feature.
  import { deltaPct } from '@/lib/analytics';

  export type DigestLevel = { revenue: number; spend: number; roas: number };
  export type DigestDelta = { value: number; direction: 'up' | 'down' | 'flat' };

  /** Compare today's level against the MEAN of a trailing baseline window.
   *  Returns a signed pct + direction per metric (reuses deltaPct's sign rules). */
  export function computeDigestDeltas(
    today: DigestLevel,
    baseline: DigestLevel[],
  ): { revenue: DigestDelta; spend: DigestDelta; roas: DigestDelta } {
    const mean = (sel: (x: DigestLevel) => number): number =>
      baseline.length === 0
        ? Number.NaN
        : baseline.reduce((s, x) => s + sel(x), 0) / baseline.length;
    const one = (cur: number, prev: number): DigestDelta => {
      if (!Number.isFinite(prev)) return { value: 0, direction: 'flat' };
      const { value, direction } = deltaPct(cur, prev);
      return { value, direction };
    };
    return {
      revenue: one(today.revenue, mean((x) => x.revenue)),
      spend: one(today.spend, mean((x) => x.spend)),
      roas: one(today.roas, mean((x) => x.roas)),
    };
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/digestSummary.ts dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts && git commit -m "feat(digest): day-over-day deltas vs trailing baseline (gap day-over-day-deltas-digest)"`

---

## Feature: campaign-died-detection
**Gap id:** `campaign-died-detection` · **Impact:** medium · **Effort:** M · **CAPI-safe:** yes · **Template:** rides the free-form digest + becomes an in-app `Insight` · **Dependencies:** none (extends `lib/insights.ts`). Feeds `push-insights-digest` + `native-prioritized-action-list`.

`insights.ts` detects zero-CONVERSION campaigns still spending (`rec-zero`) and dead-days, but has no detector for an active winner that silently went to $0. We add `detectCampaignsWentDark(campaigns)` that, over a rolling window, finds campaigns with a meaningful prior daily spend that dropped to (near-)zero on the most recent day(s), and emits a `critical` insight with the campaign reference + Ads-Manager link.

### Task 3 — `detectCampaignsWentDark` pure detector
- [ ] Write failing test `dashboard-web/src/lib/insights/__tests__/campaignDied.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { detectCampaignsWentDark } from '../campaignDied';
  import type { CampaignRow } from '@/lib/campaigns';

  function row(date: string, spend: number, over: Partial<CampaignRow> = {}): CampaignRow {
    return {
      date, storeId: 's1', storeName: 'uzoshop', platform: 'Meta',
      campaignId: 'c1', campaignName: 'Winner', adSetId: '', adSetName: '',
      spend, impressions: spend * 10, clicks: spend, conversions: spend > 0 ? 2 : 0,
      conversionValue: spend * 4,
      campaignBudgetCad: null, adSetBudgetCad: null, budgetType: '',
      effectiveStatus: null, lastLiveTickAt: null,
      regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
      regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
      ...over,
    };
  }

  describe('detectCampaignsWentDark — winner went to $0', () => {
    it('flags a campaign that spent meaningfully for >=7 days then hit $0', () => {
      const days: CampaignRow[] = [];
      for (let i = 13; i >= 1; i--) days.push(row(`2026-06-${String(i).padStart(2, '0')}`, 300));
      days.push(row('2026-06-14', 0)); // today: dark
      const out = detectCampaignsWentDark(days);
      expect(out.length).toBe(1);
      expect(out[0].severity).toBe('critical');
      expect(out[0].id).toContain('c1');
      expect(out[0].campaignId).toBe('c1');
      expect(out[0].href).toContain('business.facebook.com');
    });
    it('does NOT flag a campaign that was always tiny (<C$50/day)', () => {
      const days: CampaignRow[] = [];
      for (let i = 13; i >= 1; i--) days.push(row(`2026-06-${String(i).padStart(2, '0')}`, 5));
      days.push(row('2026-06-14', 0));
      expect(detectCampaignsWentDark(days)).toHaveLength(0);
    });
    it('does NOT flag a campaign still spending today', () => {
      const days: CampaignRow[] = [];
      for (let i = 14; i >= 1; i--) days.push(row(`2026-06-${String(i).padStart(2, '0')}`, 300));
      expect(detectCampaignsWentDark(days)).toHaveLength(0);
    });
    it('does NOT flag a campaign that only ran 2 days then stopped (not an established winner)', () => {
      const days = [row('2026-06-12', 300), row('2026-06-13', 300), row('2026-06-14', 0)];
      expect(detectCampaignsWentDark(days)).toHaveLength(0);
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/insights/__tests__/campaignDied.test.ts`
- [ ] Minimal impl `dashboard-web/src/lib/insights/campaignDied.ts` (mirror the `cAgg` + `adsManagerLink` + `campaignRef` patterns from `insights.ts:262-335`; "established winner" = ≥7 active days with prior-window mean daily spend ≥ C$50, today ≈ $0):
  ```ts
  // "Campaign went dark" detector — an established spender that silently
  // dropped to $0 (platform pause, budget exhausted, disapproval,
  // effective_status flip). Complements insights.ts's zero-CONVERSION (rec-zero)
  // and dead-day branches, which only fire while spend is still flowing.
  import type { CampaignRow } from '@/lib/campaigns';
  import type { Insight } from '@/lib/insights';
  import { fmtMoneyString } from '@/lib/format';

  const MIN_ESTABLISHED_DAYS = 7;
  const MIN_MEAN_DAILY_SPEND = 50; // CAD — only meaningful spenders
  const DARK_SPEND_EPS = 1;        // CAD — "today" spend at/below this = dark

  function adsManagerLink(platform: string, campaignId: string): string | null {
    if (!campaignId) return null;
    if (platform === 'Meta')
      return `https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${encodeURIComponent(campaignId)}`;
    if (platform === 'Google')
      return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
    return null;
  }

  export function detectCampaignsWentDark(campaigns: CampaignRow[]): Insight[] {
    if (campaigns.length === 0) return [];
    const maxDate = campaigns.reduce((m, c) => (c.date > m ? c.date : m), campaigns[0].date);
    type Agg = {
      campaignId: string; campaignName: string; storeId: string; storeName: string;
      platform: string; priorSpend: number; priorActiveDays: number; todaySpend: number;
    };
    const byKey = new Map<string, Agg>();
    for (const c of campaigns) {
      const k = `${c.storeName}::${c.platform}::${c.campaignId}`;
      if (!byKey.has(k)) {
        byKey.set(k, {
          campaignId: c.campaignId, campaignName: c.campaignName, storeId: c.storeId,
          storeName: c.storeName, platform: c.platform, priorSpend: 0, priorActiveDays: 0,
          todaySpend: 0,
        });
      }
      const e = byKey.get(k)!;
      if (c.date === maxDate) e.todaySpend += c.spend;
      else {
        e.priorSpend += c.spend;
        if (c.spend > 0) e.priorActiveDays += 1;
      }
    }
    const out: Insight[] = [];
    for (const e of byKey.values()) {
      if (e.priorActiveDays < MIN_ESTABLISHED_DAYS) continue;
      const meanDaily = e.priorSpend / Math.max(1, e.priorActiveDays);
      if (meanDaily < MIN_MEAN_DAILY_SPEND) continue;
      if (e.todaySpend > DARK_SPEND_EPS) continue;
      out.push({
        id: `rec-dark-${e.campaignId}`,
        severity: 'critical',
        kind: 'anomaly',
        scope: `${e.platform} · ${e.storeName}`,
        title: `${e.campaignName || 'קמפיין'} כבה — מ-${fmtMoneyString(meanDaily)}/יום ל-$0`,
        detail: `הוציא בממוצע ${fmtMoneyString(meanDaily)} ליום ב-${e.priorActiveDays} ימים ועכשיו ב-$0. בדוק אם הושהה / נגמר תקציב / נדחה.`,
        why: `קמפיין מבוסס (${e.priorActiveDays} ימי פעילות) שירד פתאום ל-$0 — סימן אדום לרווח אבוד.`,
        href: adsManagerLink(e.platform, e.campaignId) ?? undefined,
        weight: 96,
        campaignId: e.campaignId,
        campaignName: e.campaignName,
        platform: e.platform as Insight['platform'],
        storeId: e.storeId,
        storeName: e.storeName,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/insights/__tests__/campaignDied.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/insights/campaignDied.ts dashboard-web/src/lib/insights/__tests__/campaignDied.test.ts && git commit -m "feat(insights): detect campaigns that went dark (gap campaign-died-detection)"`

### Task 4 — wire `detectCampaignsWentDark` into `buildAllInsights`
- [ ] Add failing assertion to `dashboard-web/src/lib/__tests__/insights.test.ts` (create the file if absent; if present, append a `describe`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildAllInsights } from '@/lib/insights';
  import type { CampaignRow } from '@/lib/campaigns';
  import type { DailyRow } from '@/lib/types';
  import type { ProductRow } from '@/lib/products';

  describe('buildAllInsights includes campaign-died signals', () => {
    it('surfaces a went-dark insight for an established winner now at $0', () => {
      const campaigns: CampaignRow[] = [];
      for (let i = 13; i >= 1; i--) {
        campaigns.push({
          date: `2026-06-${String(i).padStart(2, '0')}`, storeId: 's1', storeName: 'uzoshop',
          platform: 'Meta', campaignId: 'c1', campaignName: 'Winner', adSetId: '', adSetName: '',
          spend: 300, impressions: 3000, clicks: 300, conversions: 6, conversionValue: 1200,
          campaignBudgetCad: null, adSetBudgetCad: null, budgetType: '', effectiveStatus: null,
          lastLiveTickAt: null, regConfiguredStatus: null, regEffectiveStatus: null,
          regDeliveryStatus: null, regFirstSeenAt: null, regStatusChangedAt: null,
          regLastStatusSuccessAt: null,
        });
      }
      campaigns.push({ ...campaigns[0], date: '2026-06-14', spend: 0, conversions: 0, conversionValue: 0 });
      const rows: DailyRow[] = [];
      const products: ProductRow[] = [];
      const insights = buildAllInsights(rows, campaigns, products);
      expect(insights.some((i) => i.id === 'rec-dark-c1')).toBe(true);
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/__tests__/insights.test.ts`
- [ ] Edit `dashboard-web/src/lib/insights.ts`: import + call `detectCampaignsWentDark`:
  ```ts
  import { detectCampaignsWentDark } from './insights/campaignDied';
  // ...
  export function buildAllInsights(
    rows: DailyRow[],
    campaigns: CampaignRow[],
    products: ProductRow[],
  ): Insight[] {
    const anomalies = detectAnomalies(rows);
    const recs = generateRecommendations(campaigns, products, rows);
    const dark = detectCampaignsWentDark(campaigns);
    return [...anomalies, ...recs, ...dark].sort((a, b) => b.weight - a.weight);
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/__tests__/insights.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/insights.ts dashboard-web/src/lib/__tests__/insights.test.ts && git commit -m "feat(insights): include went-dark detector in buildAllInsights (gap campaign-died-detection)"`

---

## Feature: creative-ad-fatigue-signal
**Gap id:** `creative-ad-fatigue-signal` · **Impact:** high · **Effort:** M · **CAPI-safe:** yes · **Template:** rides the free-form digest + becomes an in-app `Insight` · **Dependencies:** none for the CTR-decay + CPM-creep legs (existing `ads_daily` columns). The optional frequency-climb leg depends on the `ads_daily.frequency` migration + Meta fetcher change (Tasks 6.x within this feature). Feeds `push-insights-digest` + `native-prioritized-action-list`.

No ad-level fatigue detection exists. `cpmRoasAnalysis.ts` is a campaign-level half-over-half mean. `ads_daily` already carries per-ad impressions/clicks/spend (so CTR + CPM are derivable per day); `frequency` is NOT pulled by the Meta fetcher (only a code comment at `meta.ts:638`). We build the detector on the always-available columns first (CTR decay + CPM creep) so it ships even with `frequency = NULL`, then add the frequency-climb enhancement behind the additive nullable column.

### Task 5 — `detectAdFatigue` pure detector (CTR decay + CPM creep; frequency optional)
- [ ] Write failing test `dashboard-web/src/lib/insights/__tests__/adFatigue.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { detectAdFatigue } from '../adFatigue';
  import type { AdRow } from '@/lib/ads';

  function ad(date: string, impressions: number, clicks: number, spend: number,
              over: Partial<AdRow> = {}): AdRow {
    return {
      date, storeId: 's1', storeName: 'uzoshop', platform: 'Meta',
      campaignId: 'c1', campaignName: 'C', adSetId: 'as1', adSetName: 'AS',
      adId: 'ad1', adName: 'Creative A', spend, impressions, clicks,
      conversions: 1, conversionValue: spend * 3, frequency: null,
      regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
      regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
      ...over,
    };
  }

  describe('detectAdFatigue — CTR decay + CPM creep at the ad level', () => {
    it('flags an ad whose CTR halved AND CPM rose across recent vs prior half', () => {
      const rows: AdRow[] = [];
      // prior half: high CTR (3%), low CPM
      for (let i = 14; i >= 8; i--) rows.push(ad(`2026-06-${String(i).padStart(2, '0')}`, 10000, 300, 50));
      // recent half: CTR ~1.2%, CPM up
      for (let i = 7; i >= 1; i--) rows.push(ad(`2026-06-0${i}`, 10000, 120, 90));
      const out = detectAdFatigue(rows);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0].adId === 'ad1' || out[0].id.includes('ad1')).toBe(true);
      expect(out[0].severity === 'warning' || out[0].severity === 'opportunity').toBe(true);
    });
    it('does NOT flag a stable ad (flat CTR + flat CPM)', () => {
      const rows: AdRow[] = [];
      for (let i = 14; i >= 1; i--) rows.push(ad(`2026-06-${String(i).padStart(2, '0')}`, 10000, 300, 50));
      expect(detectAdFatigue(rows)).toHaveLength(0);
    });
    it('does NOT flag low-volume ads (<5000 impressions total) — noise floor', () => {
      const rows = [ad('2026-06-10', 200, 8, 2), ad('2026-06-12', 200, 2, 2)];
      expect(detectAdFatigue(rows)).toHaveLength(0);
    });
    it('escalates severity when frequency is climbing (>=3) where available', () => {
      const rows: AdRow[] = [];
      for (let i = 14; i >= 8; i--) rows.push(ad(`2026-06-${String(i).padStart(2, '0')}`, 10000, 300, 50, { frequency: 1.5 }));
      for (let i = 7; i >= 1; i--) rows.push(ad(`2026-06-0${i}`, 10000, 120, 90, { frequency: 4.2 }));
      const out = detectAdFatigue(rows);
      expect(out[0].why).toMatch(/תדירות|frequency|4\.2/i);
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/insights/__tests__/adFatigue.test.ts`
- [ ] Minimal impl `dashboard-web/src/lib/insights/adFatigue.ts` (per-ad aggregate split into prior-half vs recent-half over the window; flag when recent CTR ≤ 0.7× prior CTR AND recent CPM ≥ 1.2× prior CPM, with a 5000-impression noise floor; frequency-climb (recent ≥3 and rising) escalates `weight` + appends to `why`):
  ```ts
  // Ad-level creative-fatigue detector. Half-over-half per AD (not campaign):
  //   - CTR decay:  recentCTR <= 0.7 * priorCTR
  //   - CPM creep:  recentCPM >= 1.2 * priorCPM
  //   - frequency climb (Meta-only, optional): recent avg frequency >= 3 and rising
  // Built on ads_daily's always-present impressions/clicks/spend so it ships
  // before the frequency column lands; frequency only ESCALATES, never gates.
  import type { AdRow } from '@/lib/ads';
  import type { Insight } from '@/lib/insights';

  const MIN_IMPRESSIONS = 5000;
  const CTR_DECAY_RATIO = 0.7;
  const CPM_CREEP_RATIO = 1.2;
  const FREQ_ALARM = 3;

  type Half = { impressions: number; clicks: number; spend: number; freqSum: number; freqDays: number };
  function emptyHalf(): Half { return { impressions: 0, clicks: 0, spend: 0, freqSum: 0, freqDays: 0 }; }
  function ctr(h: Half): number { return h.impressions > 0 ? h.clicks / h.impressions : 0; }
  function cpm(h: Half): number { return h.impressions > 0 ? (h.spend / h.impressions) * 1000 : 0; }
  function freq(h: Half): number { return h.freqDays > 0 ? h.freqSum / h.freqDays : 0; }

  export function detectAdFatigue(ads: AdRow[]): Insight[] {
    if (ads.length === 0) return [];
    const dates = Array.from(new Set(ads.map((a) => a.date))).sort();
    if (dates.length < 4) return [];
    const mid = dates[Math.floor(dates.length / 2)];
    type Agg = {
      adId: string; adName: string; campaignId: string; campaignName: string;
      storeId: string; storeName: string; platform: string; prior: Half; recent: Half;
    };
    const byAd = new Map<string, Agg>();
    for (const a of ads) {
      if (!byAd.has(a.adId)) {
        byAd.set(a.adId, {
          adId: a.adId, adName: a.adName, campaignId: a.campaignId, campaignName: a.campaignName,
          storeId: a.storeId, storeName: a.storeName, platform: a.platform,
          prior: emptyHalf(), recent: emptyHalf(),
        });
      }
      const e = byAd.get(a.adId)!;
      const h = a.date >= mid ? e.recent : e.prior;
      h.impressions += a.impressions;
      h.clicks += a.clicks;
      h.spend += a.spend;
      if (a.frequency != null && Number.isFinite(a.frequency)) { h.freqSum += a.frequency; h.freqDays += 1; }
    }
    const out: Insight[] = [];
    for (const e of byAd.values()) {
      const total = e.prior.impressions + e.recent.impressions;
      if (total < MIN_IMPRESSIONS) continue;
      const priorCtr = ctr(e.prior), recentCtr = ctr(e.recent);
      const priorCpm = cpm(e.prior), recentCpm = cpm(e.recent);
      if (priorCtr <= 0 || priorCpm <= 0) continue;
      const ctrDecayed = recentCtr <= CTR_DECAY_RATIO * priorCtr;
      const cpmCrept = recentCpm >= CPM_CREEP_RATIO * priorCpm;
      if (!ctrDecayed || !cpmCrept) continue;
      const recentFreq = freq(e.recent);
      const freqClimb = recentFreq >= FREQ_ALARM && recentFreq > freq(e.prior);
      const ctrDropPct = Math.round((1 - recentCtr / priorCtr) * 100);
      const cpmRisePct = Math.round((recentCpm / priorCpm - 1) * 100);
      const freqNote = freqClimb ? ` תדירות עלתה ל-${recentFreq.toFixed(1)}.` : '';
      out.push({
        id: `rec-fatigue-${e.adId}`,
        severity: freqClimb ? 'warning' : 'opportunity',
        kind: 'recommendation',
        scope: `${e.platform} · ${e.storeName}`,
        title: `עייפות קריאייטיב: ${e.adName || 'מודעה'}`,
        detail: `CTR ירד ${ctrDropPct}% ו-CPM עלה ${cpmRisePct}% בחצי האחרון.${freqNote} שקול לרענן קריאייטיב.`,
        why: `CTR ${(priorCtr * 100).toFixed(2)}%→${(recentCtr * 100).toFixed(2)}%, CPM ${priorCpm.toFixed(2)}→${recentCpm.toFixed(2)}.${freqNote}`,
        weight: (freqClimb ? 82 : 68),
        campaignId: e.campaignId,
        campaignName: e.campaignName,
        platform: e.platform as Insight['platform'],
        storeId: e.storeId,
        storeName: e.storeName,
        // adId carried in id; InsightActions opens at campaign grain (no ad-drawer deeplink in scope).
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/insights/__tests__/adFatigue.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/insights/adFatigue.ts dashboard-web/src/lib/insights/__tests__/adFatigue.test.ts && git commit -m "feat(insights): ad-level creative fatigue detector (CTR decay + CPM creep; gap creative-ad-fatigue-signal)"`

### Task 6 — add `ads_daily.frequency` nullable column (migration)
- [ ] Write the migration `supabase/migrations/20260604120000_add_ads_daily_frequency.sql`:
  ```sql
  -- Gap creative-ad-fatigue-signal — per-ad Meta delivery frequency, the
  -- frequency-climb leg of fatigue detection. Additive + nullable so historical
  -- rows keep NULL (the detector's frequency leg no-ops on null) and no backfill
  -- is required; forward-fill happens from the next cron-daily Meta ad write.
  ALTER TABLE ads_daily ADD COLUMN IF NOT EXISTS frequency NUMERIC(10, 4);
  COMMENT ON COLUMN ads_daily.frequency IS 'Meta-only avg impressions-per-person for the day; NULL for Google/TikTok and pre-2026-06-04 rows. Feeds adFatigue.ts.';
  ```
- [ ] Apply via the documented procedure (hide root `.env`; move the 2 duplicate-timestamp gap files out; `supabase db push`; restore all three). Verify the column exists:
  `supabase db push` then confirm with a read in the next task (no separate test — DDL).
- [ ] Commit: `git add supabase/migrations/20260604120000_add_ads_daily_frequency.sql && git commit -m "feat(db): add nullable ads_daily.frequency column (gap creative-ad-fatigue-signal)"`

### Task 7 — add `frequency` to `AdRow` + postgres reader
- [ ] Write failing test — append to `dashboard-web/src/lib/insights/__tests__/adFatigue.test.ts` a type-level usage is already covered; instead add a reader-shape test in `dashboard-web/src/lib/__tests__/postgresReadersAdsFrequency.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import type { AdRow } from '@/lib/ads';

  // Compile-time + shape guard: AdRow must carry a nullable frequency.
  describe('AdRow.frequency contract', () => {
    it('accepts a nullable frequency field', () => {
      const r: Pick<AdRow, 'frequency'> = { frequency: null };
      expect(r.frequency).toBeNull();
      const r2: Pick<AdRow, 'frequency'> = { frequency: 2.4 };
      expect(r2.frequency).toBe(2.4);
    });
  });
  ```
- [ ] Run it (expect FAIL — `frequency` not on `AdRow`): `npm run test -- src/lib/__tests__/postgresReadersAdsFrequency.test.ts`
- [ ] Edit `dashboard-web/src/lib/ads.ts`: add to `AdRow`:
  ```ts
    /** Meta-only avg impressions-per-person (delivery frequency) for the day.
     *  NULL for Google/TikTok and rows written before migration 20260604120000.
     *  Consumed by lib/insights/adFatigue.ts (frequency-climb leg). */
    frequency: number | null;
  ```
- [ ] Edit `dashboard-web/src/lib/postgresReaders.ts` (`fetchAdsFromPostgres`): add `frequency` to the `.select(...)` column list and to the pushed row:
  ```ts
  // in the select string, append: ', frequency'
  // in the row push, add:
        frequency: (() => {
          const v = (r as { frequency?: unknown }).frequency;
          if (v === null || v === undefined) return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        })(),
  ```
  Note: confirm the `ads_enriched` VIEW exposes `frequency` (it `SELECT *`s from `ads_daily` per migration `20260530270000_phase_d_enriched_views.sql`; if it pins an explicit column list, also add `frequency` there in a sibling migration). If the VIEW pins columns, add `supabase/migrations/20260604120500_ads_enriched_add_frequency.sql` recreating the VIEW with `frequency` and apply it via the same procedure.
- [ ] Run tests (expect PASS): `npm run test -- src/lib/__tests__/postgresReadersAdsFrequency.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/ads.ts dashboard-web/src/lib/postgresReaders.ts dashboard-web/src/lib/__tests__/postgresReadersAdsFrequency.test.ts && git commit -m "feat(ads): surface ads_daily.frequency on AdRow + reader (gap creative-ad-fatigue-signal)"`

### Task 8 — pull `frequency` in the Meta ad-insights fetcher + write it in cron-daily
- [ ] Write failing test `dashboard-web/src/lib/fetchers/__tests__/metaFrequency.test.ts` (parse-shape test against a stub /insights body; mirror the existing meta fetcher test style):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { extractAdFrequency } from '../meta';

  describe('extractAdFrequency — parse Meta /insights frequency field', () => {
    it('parses a numeric frequency string', () => {
      expect(extractAdFrequency({ frequency: '3.27' })).toBeCloseTo(3.27, 2);
    });
    it('returns null when frequency is absent', () => {
      expect(extractAdFrequency({})).toBeNull();
    });
    it('returns null for a non-numeric frequency', () => {
      expect(extractAdFrequency({ frequency: 'n/a' })).toBeNull();
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/fetchers/__tests__/metaFrequency.test.ts`
- [ ] Edit `dashboard-web/src/lib/fetchers/meta.ts`:
  - add `frequency?: string;` to `MetaInsightsRow` (so the ad-level `MetaInsightsAdRow` inherits it);
  - add `frequency` to the ad-level `fields=` query string used for the ad `/insights` fetch (locate the ad-level fields list near the documented `meta.ts:638` frequency comment / the ad insights call);
  - add the per-ad returned shape's `frequency: number | null` and a small exported helper:
  ```ts
  /** Exported for parity tests only. Parse the Meta /insights `frequency`
   *  string to a number, or null when absent / non-numeric. */
  export function extractAdFrequency(row: { frequency?: string }): number | null {
    if (row.frequency == null) return null;
    const n = parseFloat(row.frequency);
    return Number.isFinite(n) ? n : null;
  }
  ```
  set the ad-row's `frequency` via `extractAdFrequency(adRow)`.
- [ ] Edit `dashboard-web/src/inngest/functions/cronDaily.ts` (the Meta `ads_daily` UPSERT writer — the block tagged `ads_daily writer in cronDaily.ts:5e`): include `frequency: <adRow.frequency>` in the row object so the column is populated. Leave Google/TikTok ad rows' `frequency` unset (NULL).
- [ ] Run tests (expect PASS): `npm run test -- src/lib/fetchers/__tests__/metaFrequency.test.ts` and the existing `npm run test -- src/inngest/functions/__tests__/cronDaily.test.ts` (must stay green).
- [ ] Commit: `git add dashboard-web/src/lib/fetchers/meta.ts dashboard-web/src/inngest/functions/cronDaily.ts dashboard-web/src/lib/fetchers/__tests__/metaFrequency.test.ts && git commit -m "feat(meta): pull + persist per-ad frequency for fatigue (gap creative-ad-fatigue-signal)"`

### Task 9 — wire `detectAdFatigue` into `buildAllInsights`
- [ ] Append a failing assertion to `dashboard-web/src/lib/__tests__/insights.test.ts`:
  ```ts
  describe('buildAllInsights includes ad fatigue when ads are supplied', () => {
    it('surfaces a fatigue insight for a decayed creative', async () => {
      const { buildAllInsights } = await import('@/lib/insights');
      // buildAllInsights gets an optional 4th arg `ads`; with decayed ads it emits rec-fatigue-*.
      // (See Task 9 impl — buildAllInsights(rows, campaigns, products, ads?).)
      expect(typeof buildAllInsights).toBe('function');
    });
  });
  ```
  (Then strengthen after impl — see below; the meaningful assertion is added with the impl in the same task.)
- [ ] Edit `dashboard-web/src/lib/insights.ts`: extend `buildAllInsights` with an optional `ads` param so existing call sites stay valid:
  ```ts
  import { detectAdFatigue } from './insights/adFatigue';
  import type { AdRow } from './ads';
  // ...
  export function buildAllInsights(
    rows: DailyRow[],
    campaigns: CampaignRow[],
    products: ProductRow[],
    ads: AdRow[] = [],
  ): Insight[] {
    const anomalies = detectAnomalies(rows);
    const recs = generateRecommendations(campaigns, products, rows);
    const dark = detectCampaignsWentDark(campaigns);
    const fatigue = detectAdFatigue(ads);
    return [...anomalies, ...recs, ...dark, ...fatigue].sort((a, b) => b.weight - a.weight);
  }
  ```
- [ ] Strengthen the test to feed decayed `AdRow[]` and assert an `id.startsWith('rec-fatigue-')` insight appears (reuse the `ad()` factory from `adFatigue.test.ts`).
- [ ] Run tests (expect PASS): `npm run test -- src/lib/__tests__/insights.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/insights.ts dashboard-web/src/lib/__tests__/insights.test.ts && git commit -m "feat(insights): include ad-fatigue in buildAllInsights (gap creative-ad-fatigue-signal)"`

---

## Feature: native-prioritized-action-list
**Gap id:** `native-prioritized-action-list` · **Impact:** medium · **Effort:** M · **CAPI-safe:** yes · **Template:** n/a (in-app) + reused by the digest · **Dependencies:** campaign-died-detection + creative-ad-fatigue-signal (so the ranked list includes them). Feeds `push-insights-digest` (the digest's top section = the same ranked list).

The AI report (`aiReport.ts:2487/2519`) delegates "5 numbered action items" to an EXTERNAL LLM via copy-paste. The dashboard never renders a curated ranked "top 5 things to do right now". `InsightsBoard` defaults collapsed and groups by severity. We add a pure `prioritizeInsights` (dedup + rank into a top-N to-do) and an always-visible in-app `ActionListPanel`.

### Task 10 — `prioritizeInsights` pure dedup + rank
- [ ] Write failing test `dashboard-web/src/lib/insights/__tests__/prioritize.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { prioritizeInsights } from '../prioritize';
  import type { Insight } from '@/lib/insights';

  function ins(over: Partial<Insight>): Insight {
    return {
      id: 'x', severity: 'info', kind: 'recommendation', title: 't', detail: 'd',
      weight: 50, ...over,
    } as Insight;
  }

  describe('prioritizeInsights — top-N deduped to-do', () => {
    it('returns at most N insights, highest weight first', () => {
      const list = [ins({ id: 'a', weight: 10 }), ins({ id: 'b', weight: 90 }), ins({ id: 'c', weight: 50 })];
      const top = prioritizeInsights(list, 2);
      expect(top.map((i) => i.id)).toEqual(['b', 'c']);
    });
    it('dedupes same campaign across detectors (keeps the highest-weight one)', () => {
      const list = [
        ins({ id: 'rec-pause-c1', campaignId: 'c1', weight: 80 }),
        ins({ id: 'rec-dark-c1', campaignId: 'c1', weight: 96 }),
      ];
      const top = prioritizeInsights(list, 5);
      expect(top).toHaveLength(1);
      expect(top[0].id).toBe('rec-dark-c1');
    });
    it('breaks ties on severity then id for determinism', () => {
      const list = [
        ins({ id: 'z', weight: 70, severity: 'warning' }),
        ins({ id: 'a', weight: 70, severity: 'critical' }),
      ];
      const top = prioritizeInsights(list, 5);
      expect(top[0].id).toBe('a'); // critical outranks warning at equal weight
    });
    it('never throws on empty input', () => {
      expect(prioritizeInsights([], 5)).toEqual([]);
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/insights/__tests__/prioritize.test.ts`
- [ ] Minimal impl `dashboard-web/src/lib/insights/prioritize.ts`:
  ```ts
  // Cross-insight dedup + rank into a curated "do this today" top-N.
  // Dedup key: campaignId when present, else scope+kind, else id — so the
  // same campaign flagged by two detectors collapses to its highest-weight call.
  import type { Insight, Severity } from '@/lib/insights';

  const SEVERITY_RANK: Record<Severity, number> = {
    critical: 5, warning: 4, opportunity: 3, positive: 2, info: 1,
  };

  function dedupeKey(i: Insight): string {
    if (i.campaignId) return `c:${i.campaignId}`;
    if (i.scope) return `s:${i.scope}:${i.kind}`;
    return `id:${i.id}`;
  }

  export function prioritizeInsights(insights: Insight[], n: number): Insight[] {
    const best = new Map<string, Insight>();
    for (const i of insights) {
      const k = dedupeKey(i);
      const cur = best.get(k);
      if (!cur || i.weight > cur.weight) best.set(k, i);
    }
    return Array.from(best.values())
      .sort((a, b) =>
        b.weight - a.weight ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.id.localeCompare(b.id),
      )
      .slice(0, Math.max(0, n));
  }
  ```
- [ ] Run tests (expect PASS): `npm run test -- src/lib/insights/__tests__/prioritize.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/insights/prioritize.ts dashboard-web/src/lib/insights/__tests__/prioritize.test.ts && git commit -m "feat(insights): prioritizeInsights dedup+rank top-N to-do (gap native-prioritized-action-list)"`

---

## Feature: native-prioritized-action-list (UI surface)
Continues the gap above with the in-app surface. UI ⇒ mockup-first per global CLAUDE.md.

### Task G1 — static HTML mockup of the ActionListPanel, deliver as an open-file link, get operator approval
- [ ] Build a static mockup `docs/superpowers/mockups/2026-06-04-action-list/action-list.html` showing the "do this today" panel in BOTH light and dark (side-by-side or a theme toggle), RTL Hebrew, with 3–5 sample ranked rows (a went-dark critical, a fatigue warning, a scale opportunity), each row showing: severity chip, title, one-line detail, a `<Money>`-style figure (tabular-nums, no clipping), and an action affordance ("פתח קמפיין" / "פתח ב-Ads Manager"). Use the project's existing token names (e.g. `bg-status-redBg`, `text-status-redFg`) as inline CSS-var references so the operator sees real theming.
- [ ] Deliver to the operator as an OPENABLE link (do NOT paste screenshots): print `open /Users/dorperetz/script-roas/docs/superpowers/mockups/2026-06-04-action-list/action-list.html`.
- [ ] STOP and get explicit operator approval (or revisions) before building the React component. Record the approved direction in the commit message.
- [ ] Commit the mockup: `git add docs/superpowers/mockups/2026-06-04-action-list/ && git commit -m "docs(mockup): action-list panel mockup for operator approval (gap native-prioritized-action-list)"`

### Task G2 — `ActionListPanel` React component (token-driven, light+dark, RTL, <Money>, HelpTooltip)
- [ ] Write failing DOM test `dashboard-web/src/components/insights/__tests__/ActionListPanel.test.tsx` (vitest.config.dom.ts):
  ```tsx
  import { describe, expect, it } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { ActionListPanel } from '../ActionListPanel';
  import type { Insight } from '@/lib/insights';

  const insights: Insight[] = [
    { id: 'rec-dark-c1', severity: 'critical', kind: 'anomaly', title: 'קמפיין כבה', detail: 'מ-$300/יום ל-$0', weight: 96, campaignId: 'c1', campaignName: 'Winner', platform: 'Meta', storeId: 's1', storeName: 'uzoshop' },
    { id: 'rec-fatigue-ad1', severity: 'warning', kind: 'recommendation', title: 'עייפות קריאייטיב', detail: 'CTR ירד 60%', weight: 82, campaignId: 'c2', platform: 'Meta', storeId: 's1', storeName: 'uzoshop' },
  ];

  describe('ActionListPanel', () => {
    it('renders the ranked actions, highest priority first', () => {
      render(<ActionListPanel insights={insights} limit={5} />);
      const headings = screen.getAllByRole('heading');
      expect(headings[0].textContent).toContain('כבה'); // highest weight first
      expect(screen.getByText(/עייפות קריאייטיב/)).toBeInTheDocument();
    });
    it('renders an empty-state when there is nothing to do', () => {
      render(<ActionListPanel insights={[]} limit={5} />);
      expect(screen.getByText(/אין פעולות|הכול נראה תקין|אין מה לעשות/)).toBeInTheDocument();
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test:components -- src/components/insights/__tests__/ActionListPanel.test.tsx`
- [ ] Implement `dashboard-web/src/components/insights/ActionListPanel.tsx`:
  - Consume `prioritizeInsights(insights, limit)`.
  - Reuse existing primitives: `Card`, `Heading`, the `InsightCardRow`/`InsightActions` already used by `InsightsBoard`, `HelpTooltip` (NO native `title=`), and `<Money>` for any numeric figure.
  - Token-driven only (`text-status-*Fg`, `bg-status-*Bg`, `border-*` from the theme) — NO raw hex/oklch. Light + dark both first-class. RTL/logical classes only (no `ml-`/`pl-`/`left-`; use `ms-`/`ps-`/`start-`). Mobile-first layout.
  - Empty state: a calm "אין פעולות דחופות כרגע" message.
- [ ] Run tests (expect PASS): `npm run test:components -- src/components/insights/__tests__/ActionListPanel.test.tsx`
- [ ] Run the guards locally on the new file: `npm run lint` (must pass `local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, design-color green-ratchet).
- [ ] Commit: `git add dashboard-web/src/components/insights/ActionListPanel.tsx dashboard-web/src/components/insights/__tests__/ActionListPanel.test.tsx && git commit -m "feat(ui): native ActionListPanel top-N to-do (gap native-prioritized-action-list)"`

### Task G3 — mount `ActionListPanel` above the collapsed InsightsBoard
- [ ] Edit `dashboard-web/src/components/InsightsBoard.tsx`: render `<ActionListPanel insights={allInsights} limit={5} />` above the existing collapsed board header (keep the board collapsed-by-default for the long tail; the action list is the always-visible curated short list). Pass the same `buildAllInsights(...)` result the board already computes (now including `ads`).
- [ ] Add/extend a DOM test asserting the panel is present even when the board is collapsed (in the existing `InsightsBoard` test file, or a new one). Run `npm run test:components`.
- [ ] Commit: `git add dashboard-web/src/components/InsightsBoard.tsx && git commit -m "feat(ui): surface ActionListPanel above collapsed InsightsBoard (gap native-prioritized-action-list)"`

---

## Feature: push-insights-digest
**Gap id:** `push-insights-digest` · **Impact:** high · **Effort:** M · **CAPI-safe:** yes · **Template:** **NEW** template `roas_action_digest` (free-form/long body) — the existing `roas_daily_summary` has 5 fixed KPI slots and can't carry recommendations. Until Meta approves the new template, the send throws `132001` and we soft-fall-back to recording the failure (mirrors `tokenFailures.ts`'s "template not approved yet" pattern). · **Dependencies:** break-even-flag-digest, day-over-day-deltas-digest, campaign-died-detection, creative-ad-fatigue-signal, native-prioritized-action-list (the digest body = ranked actions + deltas + break-even verdicts).

The rich engine is consumed only by the collapsed in-app board; nothing in `inngest/`/`lib/notifications/` imports `buildAllInsights`. The only PUSH is a static KPI snapshot. We add a server-side digest data builder, a Meta-safe message builder, an orchestrator, and a cron.

### Task 11 — `buildDigestData` server-side reader (rows + engine + deltas + verdicts)
- [ ] Append a failing block to `dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts` (mock `@/lib/postgresReaders` + `@/lib/insights`):
  ```ts
  import { vi } from 'vitest';

  describe('buildDigestData — composes rows + engine + deltas + verdicts', () => {
    it('returns ranked actions + per-store break-even verdicts + deltas', async () => {
      vi.resetModules();
      vi.doMock('@/lib/postgresReaders', () => ({
        fetchDailyDataFromPostgres: async () => ([
          { date: '2026-06-13', storeId: 's1', storeName: 'uzoshop', totalSpend: 400, revenue: 1000, cogs: 250, roas: 2.5 },
          { date: '2026-06-14', storeId: 's1', storeName: 'uzoshop', totalSpend: 400, revenue: 600, cogs: 150, roas: 1.5 },
        ]),
        fetchCampaignsFromPostgres: async () => ([]),
        fetchProductsFromPostgres: async () => ([]),
        fetchAdsFromPostgres: async () => ([]),
      }));
      vi.doMock('@/lib/insights', () => ({
        buildAllInsights: () => ([
          { id: 'rec-dark-c1', severity: 'critical', kind: 'anomaly', title: 'כבה', detail: 'd', weight: 96 },
        ]),
      }));
      const { buildDigestData } = await import('../digestSummary');
      const digest = await buildDigestData('2026-06-14', 7);
      expect(digest.actions.length).toBeGreaterThanOrEqual(1);
      expect(digest.perStore.some((s) => s.verdict.belowFloor)).toBe(true); // 1.5x is below floor
      expect(digest.totals.deltas.revenue.direction).toBe('down');
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts`
- [ ] Extend `dashboard-web/src/lib/notifications/digestSummary.ts` with `buildDigestData`:
  - Resolve `today` + a baseline window `[today-baselineDays, today-1]` and a recent window for engine inputs (e.g. last 21 days for anomalies — match `detectAnomalies`'s own 21-day slice).
  - `fetchDailyDataFromPostgres({ range })`, `fetchCampaignsFromPostgres({ range })`, `fetchProductsFromPostgres({ range })`, `fetchAdsFromPostgres({ range })`.
  - `actions = prioritizeInsights(buildAllInsights(rows, campaigns, products, ads), N)`.
  - Per-store: today's totals + `roasVerdict(roas)` + `computeDigestDeltas(todayLevel, baselineLevels)` (baseline = each store's prior days).
  - Totals: blended today + blended deltas.
  - Return a plain serializable object `{ dateStr, perStore: [{ storeName, revenue, spend, roas, verdict, deltas }], totals: { revenue, spend, roas, verdict, deltas }, actions: Insight[] }`.
  - Soft-fail like `summary.ts` (return null when there are no `data_daily` rows for `today`).
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/digestSummary.ts dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts && git commit -m "feat(digest): buildDigestData server-side reader (engine+deltas+verdicts) (gap push-insights-digest)"`

### Task 12 — `buildDigestMessageParams` Meta-safe message builder
- [ ] Write failing test `dashboard-web/src/lib/notifications/__tests__/digestMessage.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildDigestMessageParams } from '../digestMessage';

  const digest = {
    dateStr: '2026-06-14',
    perStore: [
      { storeName: 'uzoshop', revenue: 600, spend: 400, roas: 1.5,
        verdict: { band: 'red', belowTarget: true, belowFloor: true },
        deltas: { revenue: { value: -0.4, direction: 'down' }, spend: { value: 0, direction: 'flat' }, roas: { value: -0.4, direction: 'down' } } },
    ],
    totals: { revenue: 600, spend: 400, roas: 1.5,
      verdict: { band: 'red', belowTarget: true, belowFloor: true },
      deltas: { revenue: { value: -0.4, direction: 'down' }, spend: { value: 0, direction: 'flat' }, roas: { value: -0.4, direction: 'down' } } },
    actions: [
      { id: 'rec-dark-c1', severity: 'critical', kind: 'anomaly', title: 'קמפיין Winner כבה', detail: 'מ-$300/יום ל-$0', weight: 96 },
    ],
  } as const;

  describe('buildDigestMessageParams — Meta-safe params for roas_action_digest', () => {
    it('returns a non-empty param array with no \\n/\\t and no 5+ spaces', () => {
      const params = buildDigestMessageParams(digest as never, 'דיג׳סט 14/06');
      expect(params.length).toBeGreaterThan(0);
      for (const p of params) {
        expect(p).not.toMatch(/[\n\t]/);
        expect(p).not.toMatch(/ {5,}/);
      }
    });
    it('embeds the break-even verdict + a delta arrow', () => {
      const params = buildDigestMessageParams(digest as never, 't');
      const joined = params.join(' || ');
      expect(joined).toMatch(/מתחת לסף|מתחת ליעד/);
      expect(joined).toMatch(/↓|▼|down|-40/);
    });
    it('embeds the top action title', () => {
      const params = buildDigestMessageParams(digest as never, 't');
      expect(params.join(' || ')).toContain('Winner כבה');
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/notifications/__tests__/digestMessage.test.ts`
- [ ] Implement `dashboard-web/src/lib/notifications/digestMessage.ts`:
  - Reuse `formatRoasVerdict` from `breakEven.ts` for the verdict suffix.
  - Format deltas as `↑/↓/→` + signed pct (single line).
  - Build the param array to match the NEW `roas_action_digest` template's placeholder count (define the body shape now; recommend a small fixed count, e.g. {{1}} title, {{2}} totals line, {{3}} per-store lines (joined with ` · `), {{4}} top-3 action lines (joined with ` · `)). Sanitize every param with the same rule as `tokenFailures.ts:sanitizeForWhatsApp` (strip `\n\t`, collapse 5+ spaces, cap length).
  - Document the exact approved-body text the operator must submit to Meta WhatsApp Manager (in a top-of-file comment) so the operator can paste it.
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/digestMessage.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/digestMessage.ts dashboard-web/src/lib/notifications/__tests__/digestMessage.test.ts && git commit -m "feat(digest): Meta-safe digest message builder for roas_action_digest (gap push-insights-digest)"`

### Task 13 — `sendActionDigest` orchestrator
- [ ] Write failing test `dashboard-web/src/lib/notifications/__tests__/sendActionDigest.test.ts` (mock `whatsapp`, `digestSummary`, `digestMessage` — mirror `sendDailySummary.test.ts`):
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

  const sendMock = vi.fn();
  vi.mock('../whatsapp', () => ({
    sendWhatsAppTemplate: (...a: unknown[]) => sendMock(...a),
    loadActiveMetacloudConfig: async () => ({ phone1: '+972524809540', phone2: null, templateLang: 'he' }),
  }));
  vi.mock('../digestSummary', () => ({
    buildDigestData: async () => ({ dateStr: '2026-06-14', perStore: [], totals: {}, actions: [] }),
  }));
  vi.mock('../digestMessage', () => ({ buildDigestMessageParams: () => ['p1', 'p2', 'p3', 'p4'] }));

  beforeEach(() => sendMock.mockReset());
  afterEach(() => vi.resetModules());

  describe('sendActionDigest', () => {
    it('sends the digest template to the configured recipient', async () => {
      sendMock.mockResolvedValue({ messageId: 'wamid.1' });
      const { sendActionDigest } = await import('../sendActionDigest');
      const r = await sendActionDigest('2026-06-14', 'דיג׳סט 14/06');
      expect(r.skipped).toBe(false);
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].templateName).toBe('roas_action_digest');
    });
    it('skips cleanly when no active config', async () => {
      vi.resetModules();
      vi.doMock('../whatsapp', () => ({
        sendWhatsAppTemplate: sendMock,
        loadActiveMetacloudConfig: async () => null,
      }));
      vi.doMock('../digestSummary', () => ({ buildDigestData: async () => null }));
      vi.doMock('../digestMessage', () => ({ buildDigestMessageParams: () => [] }));
      const { sendActionDigest } = await import('../sendActionDigest');
      const r = await sendActionDigest('2026-06-14', 't');
      expect(r.skipped).toBe(true);
    });
    it('throws on a recipient failure so Inngest retries', async () => {
      sendMock.mockRejectedValue(new Error('132001 template not approved'));
      const { sendActionDigest } = await import('../sendActionDigest');
      await expect(sendActionDigest('2026-06-14', 't')).rejects.toThrow(/recipient/i);
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/notifications/__tests__/sendActionDigest.test.ts`
- [ ] Implement `dashboard-web/src/lib/notifications/sendActionDigest.ts` mirroring `sendDailySummary.ts` (load config → `buildDigestData` → `buildDigestMessageParams` → per-recipient `sendWhatsAppTemplate({ templateName: 'roas_action_digest', templateLang: cfg.templateLang || 'he', templateParams })` with the same `step.run` memoization + throw-on-any-failure semantics). Skip cleanly when config or digest is null.
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/sendActionDigest.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/sendActionDigest.ts dashboard-web/src/lib/notifications/__tests__/sendActionDigest.test.ts && git commit -m "feat(digest): sendActionDigest orchestrator (gap push-insights-digest)"`

### Task 14 — `cron-action-digest` cron + operator "send now" event + register in serve()
- [ ] Write failing test `dashboard-web/src/inngest/functions/__tests__/cronActionDigest.test.ts` (mock `sendActionDigest`; mirror `cronWhatsapp.test.ts` / `cronOauthCanary.test.ts` style with a `step` stub):
  ```ts
  import { describe, expect, it, vi } from 'vitest';

  const sendMock = vi.fn();
  vi.mock('@/lib/notifications/sendActionDigest', () => ({ sendActionDigest: (...a: unknown[]) => sendMock(...a) }));

  describe('cronActionDigest', () => {
    it('invokes sendActionDigest for today', async () => {
      sendMock.mockResolvedValue({ skipped: false, recipientsSucceeded: ['+972524809540'] });
      const mod = await import('../cronActionDigest');
      const step = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };
      // @ts-expect-error — minimal step stub
      const out = await mod.cronActionDigest['fn']({ step });
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(out).toBeDefined();
    });
  });
  ```
  (If the Inngest createFunction handler isn't reachable as `['fn']`, follow the exact reach pattern used in the existing `cronWhatsapp.test.ts`/`cronOauthCanary.test.ts` — read that file first and copy its handler-invocation approach.)
- [ ] Run it (expect FAIL): `npm run test -- src/inngest/functions/__tests__/cronActionDigest.test.ts`
- [ ] Implement `dashboard-web/src/inngest/functions/cronActionDigest.ts` mirroring `cronWhatsapp.ts`:
  - `cronActionDigest` — daily at a sensible IL time (recommend `TZ=Asia/Jerusalem 0 9 * * *` — a morning "do this today"; confirm in Open Questions Q2), `retries: 3`, calls `sendActionDigest(todayJerusalem(), titleDigest(todayJerusalem()), { step })` inside a top-level try/catch + `captureStepError`.
  - `eventActionDigestSendNow` — `triggers: [{ event: 'notifications/action-digest.send-now' }]`, `retries: 0` (operator "send now").
  - `export const actionDigestFunctions = [cronActionDigest];`
  - Reuse `todayJerusalem` from `sendDailySummary.ts`; add a `titleDigest(dateStr)` helper (e.g. `דיג׳סט פעולות — DD/MM/YYYY`).
- [ ] Edit `dashboard-web/src/app/api/inngest/route.ts`: import + register `...actionDigestFunctions` and `eventActionDigestSendNow` in the `serve()` functions array (MEMORY `[Inngest allowlist requirement]`: registering in `serve()` is mandatory or the cron silently never runs). Confirm `/api/inngest` is already in the auth allowlist (it is — existing crons run).
- [ ] Run tests (expect PASS): `npm run test -- src/inngest/functions/__tests__/cronActionDigest.test.ts`
- [ ] Commit: `git add dashboard-web/src/inngest/functions/cronActionDigest.ts dashboard-web/src/inngest/functions/__tests__/cronActionDigest.test.ts dashboard-web/src/app/api/inngest/route.ts && git commit -m "feat(cron): cron-action-digest + send-now event, registered in serve() (gap push-insights-digest)"`

---

## Feature: goal-pacing-alert-push
**Gap id:** `goal-pacing-alert-push` · **Impact:** medium · **Effort:** M · **CAPI-safe:** yes · **Template:** rides the digest body (copy-only) — fold the pacing line into the existing `roas_action_digest` digest rather than a separate template/cron · **Dependencies:** push-insights-digest (the digest cron + sender), and reads the monthly goal from `dashboard_state`.

`computePacing()` + `forecastMonthEnd()` classify ahead/on-pace/behind + project month-end net, but only render in the in-app `GoalTracker`. Nothing pushes a "behind pace" alert. The goal lives in `dashboard_state` under `roas-dashboard:monthly-revenue-goal` (server-readable via `fetchDashboardStateFromPostgres`). We compute pacing server-side and fold a pacing line into the digest — surfaced only when status is `behind` (avoid noise on ahead/on-pace).

### Task 15 — `computeGoalPacingLine` server-side (read goal + run pacing/forecast)
- [ ] Write failing test — append to `dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts`:
  ```ts
  describe('goal pacing line', () => {
    it('returns a behind-pace line when MTD lags expected', async () => {
      vi.resetModules();
      vi.doMock('@/lib/postgresReaders', () => ({
        fetchDashboardStateFromPostgres: async () => ({ kv: { 'roas-dashboard:monthly-revenue-goal': 100000 }, updatedAtByKey: {} }),
      }));
      const { computeGoalPacingLine } = await import('../digestSummary');
      // 40% of the month elapsed, but only 10% of goal achieved → behind.
      const line = await computeGoalPacingLine({ mtdRevenue: 10000, daysElapsed: 12, daysInMonth: 30 });
      expect(line).not.toBeNull();
      expect(line!.status).toBe('behind');
      expect(line!.text).toMatch(/מאחור|behind|פיגור/);
    });
    it('returns null when status is on-pace/ahead (no noise)', async () => {
      vi.resetModules();
      vi.doMock('@/lib/postgresReaders', () => ({
        fetchDashboardStateFromPostgres: async () => ({ kv: { 'roas-dashboard:monthly-revenue-goal': 100000 }, updatedAtByKey: {} }),
      }));
      const { computeGoalPacingLine } = await import('../digestSummary');
      const line = await computeGoalPacingLine({ mtdRevenue: 50000, daysElapsed: 15, daysInMonth: 30 });
      expect(line).toBeNull();
    });
    it('returns null when no goal is set', async () => {
      vi.resetModules();
      vi.doMock('@/lib/postgresReaders', () => ({
        fetchDashboardStateFromPostgres: async () => ({ kv: {}, updatedAtByKey: {} }),
      }));
      const { computeGoalPacingLine } = await import('../digestSummary');
      expect(await computeGoalPacingLine({ mtdRevenue: 10000, daysElapsed: 12, daysInMonth: 30 })).toBeNull();
    });
  });
  ```
- [ ] Run it (expect FAIL): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts`
- [ ] Implement `computeGoalPacingLine` in `dashboard-web/src/lib/notifications/digestSummary.ts`:
  - Read the goal: `const { kv } = await fetchDashboardStateFromPostgres(); const goal = Number(kv['roas-dashboard:monthly-revenue-goal']) || null;`
  - `const pacing = computePacing(goal, mtdRevenue, daysElapsed, daysInMonth);` (import from `@/lib/insights`).
  - Return `null` unless `pacing.status === 'behind'` (no noise on ahead/on-pace) AND `goal` is set.
  - On `behind`, return `{ status, text }` where `text` is a single-line Hebrew pacing string (e.g. `יעד חודשי: ${pct}% מהיעד, צפי ${expectedPct}% — בפיגור`), Meta-safe.
- [ ] Wire `computeGoalPacingLine` into `buildDigestData` (compute the business-wide MTD revenue from the recent rows — month-to-date sum across all stores — and attach `digest.goalPacing = line` (nullable)). Update `buildDigestMessageParams` to append the pacing line into the totals/actions param when present (extend the Task 12 test to assert it appears when behind).
- [ ] Run tests (expect PASS): `npm run test -- src/lib/notifications/__tests__/digestSummary.test.ts src/lib/notifications/__tests__/digestMessage.test.ts`
- [ ] Commit: `git add dashboard-web/src/lib/notifications/digestSummary.ts dashboard-web/src/lib/notifications/digestMessage.ts dashboard-web/src/lib/notifications/__tests__/digestSummary.test.ts dashboard-web/src/lib/notifications/__tests__/digestMessage.test.ts && git commit -m "feat(digest): fold behind-pace monthly-goal alert into the digest (gap goal-pacing-alert-push)"`

---

## Finalization (after all features green)

### Task F1 — docs currency (pre-push gate)
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md`: new section "דיג׳סט פעולות ב-WhatsApp" describing the daily action digest (ranked do-this-today list, break-even verdicts, day-over-day deltas, campaign-died + creative-fatigue alerts, behind-pace goal alert), the in-app ActionListPanel on the Home tab, and the operator step to submit the `roas_action_digest` template to Meta WhatsApp Manager (paste the body from `digestMessage.ts`). Bump the User Manual version footer.
- [ ] Update `docs/ARCHITECTURE.md`: document `cron-action-digest` (schedule, data path: postgresReaders → buildAllInsights+prioritize → digestMessage → sendWhatsAppTemplate), the `ads_daily.frequency` column + migration `20260604120000`, the new `lib/insights/*` + `lib/notifications/*` modules, and that the digest is a NEW template (copy-only items reuse the engine, the long body needs Meta approval).
- [ ] Commit: `git add docs/ROAS-Dashboard-User-Manual.md docs/ARCHITECTURE.md && git commit -m "docs: action digest + ads_daily.frequency (WS3 alerts & action digest)"`

### Task F2 — full gate sweep + single deploy
- [ ] `npx tsc --noEmit` (expect clean).
- [ ] `npm run test` (node config — all new lib + notifications + insights + cron tests green; existing suite stays green).
- [ ] `npm run test:components` (DOM config — ActionListPanel + InsightsBoard tests green).
- [ ] `npm run lint` (eslint guards pass on all new/changed files).
- [ ] Manually verify the in-app ActionListPanel in BOTH light and dark themes locally (per "no drip-deploy" — verify before the single deploy).
- [ ] ONE deploy only: `git push origin main` (Vercel Git integration builds it; do NOT also run `vercel deploy --prod`).
- [ ] Post-deploy: operator submits the `roas_action_digest` template to Meta; until approved, `sendActionDigest` throws 132001 and the cron run is marked failed (visible in Inngest) — no code change needed once approval lands. Optionally trigger `notifications/action-digest.send-now` once approved to smoke-test.

---

## Self-Review

**Spec coverage (every listed gap id is its own Feature with full TDD tasks):**
- `break-even-flag-digest` → Feature break-even-flag-digest (Task 1). Copy-only; reuses fixed ROAS bands per MEMORY.
- `day-over-day-deltas-digest` → Feature day-over-day-deltas-digest (Task 2). Copy-only.
- `campaign-died-detection` → Feature campaign-died-detection (Tasks 3–4). Detector + wiring.
- `creative-ad-fatigue-signal` → Feature creative-ad-fatigue-signal (Tasks 5–9). Detector (existing columns) + `frequency` migration + Meta fetcher + reader + wiring.
- `native-prioritized-action-list` → Feature native-prioritized-action-list (Tasks 10 + G1–G3). Pure rank + mockup-first UI.
- `push-insights-digest` → Feature push-insights-digest (Tasks 11–14). Reader + message + orchestrator + cron. NEW template flagged.
- `goal-pacing-alert-push` → Feature goal-pacing-alert-push (Task 15). Folded into the digest (copy-only, behind-pace only).

**Placeholder scan:** No "TODO" / "similar to Task N" / pseudocode left in impl blocks — every task carries real file paths, real imports against verified symbols (`roasLabel` @ analytics.ts:448, `deltaPct` @ analytics.ts:456, `buildAllInsights`/`computePacing`/`forecastMonthEnd` @ insights.ts, `sendWhatsAppTemplate`/`loadActiveMetacloudConfig` @ whatsapp.ts, `fetchDailyDataFromPostgres`/`fetchCampaignsFromPostgres`/`fetchProductsFromPostgres`/`fetchAdsFromPostgres`/`fetchDashboardStateFromPostgres` @ postgresReaders.ts, `STATE_KEYS` 'roas-dashboard:monthly-revenue-goal' @ cloudSync.ts:57, `whatsappCronFunctions`/`serve()` @ route.ts), real test commands (per-file vitest invocations under both configs), and real `git commit` lines.

**Type consistency:** `Insight` shape reused verbatim (id/severity/kind/title/detail/why/href/weight/campaignId/campaignName/platform/storeId/storeName) — detectors emit exactly that shape. `AdRow.frequency: number | null` added in one place (ads.ts) and threaded through the reader + fetcher + cron writer + detector (null-safe everywhere). `buildAllInsights`'s new `ads` param defaults `[]` so existing call sites (`InsightsBoard.tsx`) compile unchanged. Digest data objects are plain serializable JSON (Inngest step boundary safe). Meta-safe sanitization (no `\n`/`\t`/5+ spaces, length cap) applied to every WhatsApp param, matching the existing `tokenFailures.ts`/`templateParams.ts` constraint.

**Risk notes baked in:** the `ads_enriched` VIEW may pin an explicit column list (Task 7 includes a contingency sibling migration to add `frequency` to the VIEW). The exact handler-invocation pattern for the cron test must be copied from the existing `cronWhatsapp.test.ts` (flagged in Task 14). The new `roas_action_digest` Meta template is the only item that can't go live instantly — surfaced in both the Feature header and Finalization.

## Open questions for the operator
1. **Break-even definition (Q1).** MEMORY `[ROAS bands 2x/3x = correct break-even]` says NOT to add a separate CM%-derived break-even number — so the digest's "below break-even" flag reuses the fixed 2x floor / 3x target bands. Confirm that "below 2x = below break-even" / "2–2.7x = below target" wording is what you want in the WhatsApp message (vs an explicit CM%-derived figure, which the memory currently forbids).
2. **Digest schedule (Q2).** Proposed: one daily morning push at 09:00 IL ("do this today"). Do you want it daily, or weekly (e.g. Monday), or twice (morning + a Friday weekly roll-up)? And should it coexist with the existing 12:00/18:00/00:30 KPI summaries, or replace one of them?
3. **New Meta template (Q3).** The prioritized free-text digest needs a NEW WhatsApp template (`roas_action_digest`) — the approved 5-slot `roas_daily_summary` can't carry recommendations. The exact body text will be in `digestMessage.ts` for you to paste into Meta WhatsApp Manager; approval takes ~24–48h. OK to proceed with a new template, or would you prefer the digest go to a different channel (e.g. a plain WhatsApp text/free-form message inside the 24h customer-care window) to avoid the approval wait?
4. **Action list size (Q4).** Top-5 in both the in-app panel and the WhatsApp digest? Or a different N for each (e.g. top-3 in WhatsApp to keep the message short, top-8 in-app)?
5. **Recipients (Q5).** The proactive alerts in `tokenFailures.ts` go ONLY to `+972524809540`. Should the action digest go to the same single number, or to the `notification_config` phone1/phone2 like the daily KPI summary?
6. **Frequency backfill (Q6).** `ads_daily.frequency` fills forward from the next nightly run only. Do you want a one-time `eventBackfill` over, say, the last 30 days so the fatigue detector's frequency-climb leg has history immediately, or is forward-fill fine (CTR-decay + CPM-creep legs work from day one regardless)?

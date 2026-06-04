# Data Trust & Freshness On-Screen Implementation Plan
> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Make the dashboard's data-trust state legible *where decisions happen* — surface the cross-source reconciliation result, FX failures, manual overrides, live-vs-finalized provenance, source-level freshness, cohort as-of staleness, and TikTok mapping coverage — so the operator never has to run a CLI test or open `/operator` to learn that a number is provisional, overridden, stale, or under-attributed. Seven small surfacing/flag features (DQ-1 … DQ-7); one is an alert-wire (DQ-2), the rest are display + small backend reads.

Architecture: Mirror the existing freshness/trust stack. The data layer already carries every fact we need: `reconcileWindow` (lib/audit/reconcile.ts) computes INV-7/9/10; `data_daily` carries `is_finalized`/`source`/`last_live_tick_at`/`reconciled_at` (migration 20260530100002); `data_freshness` carries the (store×platform×scope×table) lag matrix; `token_failures` already lists `'fx'` as a provider; `customer_cohort_monthly` is weekly-refreshed; `campaignStoreMap` resolves per-campaign→store. Each feature reads one of these via a thin server reader → an `/api` shim (where a client surface needs it) → a small token-driven primitive (chip/badge/banner) rendered on the Home hero, P&L, Customers tab, or operator Health tab. New UI composes existing primitives (`Card`, `Badge`, `Money`, `HelpTooltip`, `FreshnessBadge`, `TableBase`) — no bespoke markup, no hardcoded colours.

Tech Stack: Next.js (App Router) + TypeScript, React client components with SWR for live panels, Tailwind with token-only classes (`text-status-*`, `bg-glass-*`, `text-ink-*`, logical `text-start`/`ms-*`/`pe-*`), Supabase (`@supabase/supabase-js`) via `getSupabaseAdmin()` (writers) / `getSupabase()` (readers), Inngest crons (cronDaily, cronCohortRefresh), vitest (node default + `vitest.config.dom.ts` for components). Deploy = `git push origin main`. Gates before push: `tsc --noEmit`, `npm run test`, `npm run test:components`, `npm run lint`, and the docs-currency pre-push gate (UI/component change → update `docs/ROAS-Dashboard-User-Manual.md`; lib/inngest/migration change → update `docs/ARCHITECTURE.md`).

---

## File Structure

### Created
- `dashboard-web/src/lib/audit/reconcileLive.ts` — server reader: fetches the today/yesterday window from the 4 production tables, runs `reconcileWindow`, returns `{ asOf, window, violations, ok }`. One responsibility: turn the test-only harness into a callable server function. (DQ-1)
- `dashboard-web/src/app/api/operator/reconcile/route.ts` — HTTP shim around `reconcileLive`, soft-fail 200 (mirrors `/api/operator/freshness`). (DQ-1)
- `dashboard-web/src/components/operator/ReconcilePanel.tsx` — operator Health-tab panel: SWR(15s) over the reconcile route, renders OK/violation summary + a per-violation `TableBase`. (DQ-1)
- `dashboard-web/src/components/home/ReconcileBanner.tsx` — Home-tab slim banner: "N discrepancies vs source — view in /operator" when violations exist; nothing when clean. (DQ-1)
- `dashboard-web/src/components/ui/OverrideFlag.tsx` — token-driven inline "ידני" (manual) chip + tooltip, shown on any number that was overwritten by a manual override. (DQ-3)
- `dashboard-web/src/lib/home/overridesActive.ts` — pure helper: given the active range + override rows, returns which platforms/stores are currently override-driven. (DQ-3)
- `dashboard-web/src/app/api/active-overrides/route.ts` — reader shim: returns the manual_overrides rows overlapping the active range so the client can flag affected cells. (DQ-3)
- `dashboard-web/src/components/ui/ProvenanceFlag.tsx` — token-driven "אומדן חי" (live estimate) vs nothing-when-final chip, driven by `is_finalized`/`source`. (DQ-4)
- `dashboard-web/src/lib/freshness/provenance.ts` — pure mapper: `(rows) → { allFinalized, anyLiveTick, source }` for the active range. (DQ-4)
- `dashboard-web/src/lib/freshness/sourceStatus.ts` — pure mapper: `data_freshness` rows → per-(store,platform) worst non-success status for the Home freshness signal. (DQ-5)
- `dashboard-web/src/app/api/freshness-summary/route.ts` — reader shim: compact per-(store,platform) status rollup for the dashboard (non-operator). (DQ-5)
- `dashboard-web/src/components/home/SourceHealthChip.tsx` — Home chip: "Meta · auth_error" / "Google · 6h" when any source is unhealthy; nothing when all green. (DQ-5)
- `dashboard-web/src/components/CohortAsOfBadge.tsx` — Customers-tab "עודכן: <date>" cohort as-of badge + stale tooltip. (DQ-6)
- `dashboard-web/src/lib/audit/tiktokCoverage.ts` — pure helper: from TikTok account total + Σ mapped campaigns + the store map, compute `{ unmappedCampaignIds, unattributedSpendCad, mappedSpendCad }`. (DQ-7)
- `dashboard-web/src/app/api/operator/tiktok-coverage/route.ts` — reader shim around `tiktokCoverage`. (DQ-7)
- `dashboard-web/src/components/operator/TikTokCoveragePanel.tsx` — live TikTok mapping-coverage panel replacing the static disclaimer's silent-risk gap. (DQ-7)
- `supabase/migrations/20260604130000_manual_overrides_audit_cols.sql` — `ADD COLUMN IF NOT EXISTS updated_at`, `created_by`, `applies_to` to `manual_overrides` (DQ-3, nullable/defaulted).
- `supabase/migrations/20260604140000_cohort_refresh_meta.sql` — `data_freshness`-compatible marker; records cron-cohort-refresh `last_success_at` so the Customers tab can read a real as-of (DQ-6).

### Modified
- `dashboard-web/src/inngest/functions/cronDaily.ts` — wire `notifyTokenFailure({ provider: 'fx', … })` into the TikTok-FX catch block (~line 832); also add the Meta(ILS)→CAD FX path's failure if reachable. (DQ-2)
- `dashboard-web/src/lib/postgresReaders.ts` — extend `fetchDailyDataFromPostgres` select + `DailyRow` mapping to project `is_finalized` / `source` / `last_live_tick_at` / `reconciled_at` (DQ-4); add `fetchManualOverridesForRange` (DQ-3); add `fetchTikTokCoverageInputs` (DQ-7).
- `dashboard-web/src/lib/types.ts` — add `isFinalized` / `source` / `lastLiveTickAt` / `reconciledAt` to `DailyRow` (DQ-4).
- `dashboard-web/src/inngest/functions/cronCohortRefresh.ts` — call `recordFreshness({ scope: 'cohort_monthly', … })` (or write the new marker) on per-store success so the as-of is real (DQ-6).
- `dashboard-web/src/components/home/CommandCenterHero.tsx` — render `<ProvenanceFlag>` + `<OverrideFlag>` + `<SourceHealthChip>` in the header region (DQ-3/4/5).
- `dashboard-web/src/components/PnLBreakdown.tsx` — render `<ProvenanceFlag>` + `<OverrideFlag>` near the P&L spend/profit lines (DQ-3/4).
- `dashboard-web/src/components/CustomerValueTab.tsx` — render `<CohortAsOfBadge>` in the SectionIntro region (DQ-6).
- `dashboard-web/src/app/operator/HealthTab.tsx` — add `<ReconcilePanel>` + `<TikTokCoveragePanel>` sections; keep the static disclaimer but append the live coverage panel under it (DQ-1/7).
- `dashboard-web/src/app/api/cohorts/route.ts` + `CohortsResponse` — add `asOf: string | null` to the response (DQ-6).
- `docs/ROAS-Dashboard-User-Manual.md` — new "אמון בנתונים" (data trust) section documenting every chip/panel (all features).
- `docs/ARCHITECTURE.md` — document the reconcile-live reader, FX alert wire, override audit cols, provenance projection, freshness-summary, cohort as-of marker, TikTok coverage reader (all features).

---

## Conventions for every task (read once, apply throughout)
- **TDD**: write the failing test FIRST, run it, see it FAIL for the expected reason, then write minimal impl, run it, see PASS.
- **Test commands**: node-default logic/reader tests → `npx vitest run <path>`; component tests (`*.dom.test.tsx`) → `npx vitest run --config vitest.config.dom.ts <path>`.
- **UI tasks**: pure logic/helpers are TDD-first. The VISIBLE component itself follows the global "mockup first" rule — see the per-feature **Task 0 (mockup)** at the head of each UI feature. Build the component only after operator approves the static HTML mockup.
- **Token-only**: no raw hex/oklch/px colours in components; use `text-status-*` / `bg-status-*` / `text-ink-*` / `bg-glass-*`. No physical-direction classes (`ml-`/`pr-`/`left-`) in components — use logical (`ms-`/`pe-`/`start-`). No native `title=` — use `<HelpTooltip>`. Numbers through `<Money>`. Must pass `local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, `local/no-hex-color-in-components`, and the design-color green-ratchet.
- **Mapping-aware**: any per-store number reads from `data_daily` (via the existing readers / `agg_data_daily_for_date`) + `campaignStoreMap` — never raw account totals.
- **CAPI-safe**: read-only. No feature here sends any event to any pixel/CAPI. (Trivially satisfied — every task is a read or a display.)
- **Commit cadence**: one commit per task, conventional-commit style, ending with the Co-Authored-By trailer. Do NOT push (operator pushes).

---

## Migration apply procedure (used by DQ-3 + DQ-6)
When a task adds a migration, apply it to prod with the documented procedure (see memory `reference_supabase_migration_procedure`):
1. Temporarily hide the root `.env` (dotted keys break the CLI parser): `mv .env .env.hidden`.
2. Move the 2 duplicate-timestamp gap files out so `db push` doesn't fail on duplicate key:
   `mv supabase/migrations/20260530300000_phase_d_soak_cleanup_stale_tiktok_uzoshop_campaigns_daily.sql /tmp/` and `mv supabase/migrations/20260530300000_recompute_data_daily_derived.sql /tmp/`.
3. `supabase db push`.
4. Restore: move both files back into `supabase/migrations/` and `mv .env.hidden .env`.
All new columns are `ADD COLUMN IF NOT EXISTS`, nullable or defaulted, so the migration is safe to re-run and needs no backfill of the new columns (existing rows get the DEFAULT/NULL). A re-backfill note is included per migration where one is genuinely needed.

---

## Feature: DQ-1 — Surface window-level reconciliation (platform vs Shopify) to the operator
Impact: high · Effort: M · CAPI-safe: yes (read-only) · Depends on: none.
The harness (`reconcileWindow`, INV-7/9/10) exists but runs only via `npm run audit:reconcile`. We expose it as a server reader → `/api` shim → an operator Health-tab panel AND a slim Home banner, so a silent campaigns_daily↔data_daily drift becomes visible without a CLI test.

### Task 1 — `reconcileLive` server reader (pure-fetch wrapper around the harness)
- [ ] Write failing test `dashboard-web/src/lib/audit/__tests__/reconcileLive.test.ts`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { reconcileRows } from '@/lib/audit/reconcileLive';

  describe('reconcileRows', () => {
    it('returns ok=true and no violations when all four sources agree', () => {
      const date = '2026-06-04';
      const storeName = 'uzoshop';
      const res = reconcileRows({
        dataRows: [{ date, storeName, fbSpend: 10, gaSpend: 0, ttSpend: 0, totalSpend: 10, revenue: 100, roas: 10 }],
        productRows: [{ date, storeName, revenue: 100, netRevenue: 100, orders: 5 }],
        campaignRows: [{ date, storeName, platform: 'Meta', spend: 10 }],
        ordersRows: [{ date, storeName, totalCad: 100 }],
        asOf: '2026-06-04T12:00:00Z',
      });
      expect(res.ok).toBe(true);
      expect(res.violations).toHaveLength(0);
      expect(res.asOf).toBe('2026-06-04T12:00:00Z');
    });

    it('returns ok=false with the INV-7 Meta violation when campaigns drift from data_daily', () => {
      const date = '2026-06-04';
      const storeName = 'uzoshop';
      const res = reconcileRows({
        dataRows: [{ date, storeName, fbSpend: 50, gaSpend: 0, ttSpend: 0, totalSpend: 50, revenue: 100, roas: 2 }],
        productRows: [{ date, storeName, revenue: 100, netRevenue: 100, orders: 5 }],
        campaignRows: [{ date, storeName, platform: 'Meta', spend: 10 }], // drift: 10 vs 50
        ordersRows: [{ date, storeName, totalCad: 100 }],
        asOf: '2026-06-04T12:00:00Z',
      });
      expect(res.ok).toBe(false);
      expect(res.violations.some((v) => v.label.startsWith('INV-7 Meta'))).toBe(true);
    });
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/audit/__tests__/reconcileLive.test.ts` → expected FAIL (module `reconcileLive` does not exist).
- [ ] Minimal impl `dashboard-web/src/lib/audit/reconcileLive.ts`:
  ```ts
  // reconcileLive.ts — turns the test-only reconcileWindow harness into a
  // callable server function for the operator Health tab + Home banner (DQ-1).
  // `reconcileRows` is the PURE core (no I/O) so it stays unit-testable; the
  // async `reconcileLive` wires it to the live readers.
  import { reconcileWindow, type Violation } from '@/lib/audit/reconcile';

  export interface ReconcileResult {
    asOf: string;
    ok: boolean;
    violations: Violation[];
  }

  export function reconcileRows(
    input: Parameters<typeof reconcileWindow>[0] & { asOf: string },
  ): ReconcileResult {
    const { asOf, ...window } = input;
    const violations = reconcileWindow(window);
    return { asOf, ok: violations.length === 0, violations };
  }
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/audit/__tests__/reconcileLive.test.ts` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): pure reconcileRows core for live reconciliation (DQ-1)"`

### Task 2 — async `reconcileLive` over the live readers
- [ ] Write failing test extension in the SAME file `reconcileLive.test.ts` — add a block that mocks the readers and asserts wiring:
  ```ts
  import * as readers from '@/lib/postgresReaders';
  import * as audit from '@/lib/audit/reconcile.fetchers'; // window fetchers (see impl note)
  // (If the audit:reconcile live test already has a window-fetch helper, import THAT
  //  rather than re-implementing; grep src/lib/audit/__tests__/reconcile.live.test.ts
  //  for the existing fetch path and reuse it. The test must assert reconcileLive()
  //  returns { asOf, ok, violations } over the today+yesterday window.)
  ```
  Concretely, assert: `reconcileLive()` resolves to a `ReconcileResult` whose `asOf` is an ISO string and whose `violations` is an array, with the four window-fetchers mocked to agreeing rows → `ok === true`.
- [ ] Run: `npx vitest run dashboard-web/src/lib/audit/__tests__/reconcileLive.test.ts` → expected FAIL (`reconcileLive` not exported).
- [ ] Inspect the existing live harness to reuse its window-build path: read `dashboard-web/src/lib/audit/__tests__/reconcile.live.test.ts` and identify how it assembles `dataRows/productRows/campaignRows/ordersRows` from the production readers. Extract that assembly (if it is inline in the test) into a small exported helper `buildReconcileWindow({ from, to })` in `reconcileLive.ts` so production and the live test share ONE path (DRY).
- [ ] Minimal impl — add to `reconcileLive.ts`:
  ```ts
  import { getTodayInIsraelTz } from '@/lib/dateRange';
  // buildReconcileWindow assembles the 4 row arrays from the live readers for
  // [from..to]; reuse the readers the live harness already uses (data_daily,
  // products_daily, campaigns_daily, orders_attribution). Today + yesterday is
  // the decision-relevant window (cross-midnight refunds + live ticks).
  export async function reconcileLive(now: string = new Date().toISOString()): Promise<ReconcileResult> {
    const today = getTodayInIsraelTz(now);
    const from = /* today - 1 day in IL tz */;
    const window = await buildReconcileWindow({ from, to: today });
    return reconcileRows({ ...window, asOf: now });
  }
  ```
  (Compute `from` with the existing date helper used elsewhere for "yesterday"; do not hand-roll UTC math — reuse `lib/dateRange.ts`.)
- [ ] Run: `npx vitest run dashboard-web/src/lib/audit/__tests__/reconcileLive.test.ts` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): reconcileLive over today+yesterday window via shared fetchers (DQ-1)"`

### Task 3 — `/api/operator/reconcile` shim
- [ ] Write failing test `dashboard-web/src/app/api/operator/reconcile/__tests__/route.test.ts`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  vi.mock('@/lib/audit/reconcileLive', () => ({
    reconcileLive: vi.fn(async () => ({ asOf: '2026-06-04T12:00:00Z', ok: true, violations: [] })),
  }));
  import { GET } from '@/app/api/operator/reconcile/route';

  describe('GET /api/operator/reconcile', () => {
    it('returns 200 with the reconcile result', async () => {
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.asOf).toBe('2026-06-04T12:00:00Z');
    });
    it('soft-fails 200 with ok:false + error on throw', async () => {
      const mod = await import('@/lib/audit/reconcileLive');
      (mod.reconcileLive as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error('boom'));
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/app/api/operator/reconcile/__tests__/route.test.ts` → expected FAIL (route missing).
- [ ] Minimal impl `dashboard-web/src/app/api/operator/reconcile/route.ts` — mirror `/api/operator/freshness/route.ts` exactly (runtime nodejs, force-dynamic, soft-fail 200, `captureRouteError`, `userFacingError`):
  ```ts
  import { NextResponse } from 'next/server';
  import { reconcileLive, type ReconcileResult } from '@/lib/audit/reconcileLive';
  import { userFacingError } from '@/lib/apiErrors';
  import { captureRouteError } from '@/lib/sentry/capture';
  export const runtime = 'nodejs';
  export const dynamic = 'force-dynamic';
  export type ReconcileResponse = ReconcileResult & { error?: string };
  export async function GET() {
    try {
      const result = await reconcileLive();
      return NextResponse.json<ReconcileResponse>(result);
    } catch (e) {
      captureRouteError('/api/operator/reconcile', e);
      const msg = e instanceof Error ? e.message : String(e);
      console.error('/api/operator/reconcile GET threw:', msg);
      return NextResponse.json<ReconcileResponse>(
        { asOf: new Date().toISOString(), ok: false, violations: [], error: userFacingError(msg) },
        { status: 200 },
      );
    }
  }
  ```
- [ ] Run: `npx vitest run dashboard-web/src/app/api/operator/reconcile/__tests__/route.test.ts` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): /api/operator/reconcile soft-fail shim (DQ-1)"`

### Task 4 (mockup) — ReconcilePanel + ReconcileBanner static HTML mockup
- [ ] Build `docs/superpowers/mockups/2026-06-04-data-trust/reconcile.html` — a static, token-styled (copy the project's light+dark CSS vars) preview showing (a) the operator panel with an "✓ הכל תואם" green state AND a populated violation table, and (b) the slim Home banner. Include both light and dark toggles.
- [ ] Deliver to operator as an openable link: print `open docs/superpowers/mockups/2026-06-04-data-trust/reconcile.html`.
- [ ] STOP — get operator approval before building the components. (Do not auto-proceed; this is the global mockup-first rule.)

### Task 5 — `<ReconcilePanel>` operator Health-tab panel
- [ ] Write failing test `dashboard-web/src/components/operator/__tests__/ReconcilePanel.dom.test.tsx` (SWR mocked via the fetcher; mirror an existing panel test like `FreshnessPanel`'s):
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  vi.mock('@/lib/operatorClient', () => ({
    operatorFetch: vi.fn(async () => ({
      json: async () => ({ asOf: '2026-06-04T12:00:00Z', ok: false, violations: [{ label: 'INV-7 Meta spend 2026-06-04/uzoshop', detail: 'data_daily 50 vs campaigns_daily 10' }] }),
    })),
  }));
  import { ReconcilePanel } from '@/components/operator/ReconcilePanel';
  it('renders the violation label + detail when not ok', async () => {
    render(<ReconcilePanel />);
    expect(await screen.findByText(/INV-7 Meta spend/)).toBeInTheDocument();
    expect(await screen.findByText(/data_daily 50 vs campaigns_daily 10/)).toBeInTheDocument();
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/operator/__tests__/ReconcilePanel.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/operator/ReconcilePanel.tsx` — `useSWR('/api/operator/reconcile', fetcher, { refreshInterval: 15_000, revalidateOnFocus: true })`; render a green "✓ הכל תואם · נכון ל-<relative asOf>" state when `ok`, else a `TableBase` of `{label, detail}` rows. Reuse the `StatusIcon`/`statusTextClass` token palette pattern from `FreshnessPanel.tsx`. Token-only, RTL (`text-start`), numbers via `<Money>` if any monetary detail is rendered.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/operator/__tests__/ReconcilePanel.dom.test.tsx` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): ReconcilePanel on operator Health tab (DQ-1)"`

### Task 6 — `<ReconcileBanner>` Home-tab slim banner
- [ ] Write failing test `dashboard-web/src/components/home/__tests__/ReconcileBanner.dom.test.tsx`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  vi.mock('swr', async () => ({ default: () => ({ data: { ok: false, violations: [{ label: 'x', detail: 'y' }, { label: 'z', detail: 'w' }], asOf: '2026-06-04T12:00:00Z' }, isLoading: false }) }));
  import { ReconcileBanner } from '@/components/home/ReconcileBanner';
  it('shows the discrepancy count when not ok', () => {
    render(<ReconcileBanner />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });
  it('renders nothing when ok', () => {
    // separate describe with a clean=ok mock; assert container is empty
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home/__tests__/ReconcileBanner.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/home/ReconcileBanner.tsx` — SWR over the same route; when `ok` return `null`; else a slim `Card`/`Badge tone="warning"` row: "⚠ N פערים מול המקור — לפרטים: /operator" with a `HelpTooltip` explaining INV-7/9/10. Token-only, logical classes, no native title.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home/__tests__/ReconcileBanner.dom.test.tsx` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): Home ReconcileBanner shows source discrepancies (DQ-1)"`

### Task 7 — Wire panels into HealthTab + Home, update docs
- [ ] Add `<ReconcilePanel>` as a new `<section>` at the top of `HealthTab.tsx` (above "בעיות טוקן"), with a `<Heading level="hero">פיוס מקורות</Heading>`. Render `<ReconcileBanner>` near the top of the Home tab (in `Dashboard.tsx`'s HomeTab region, above `<CommandCenterHero>`).
- [ ] No new unit test needed for wiring; run the full DOM suite to confirm no regression: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/operator dashboard-web/src/components/home` → expected PASS.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (new data-trust section: what the panel + banner mean) and `docs/ARCHITECTURE.md` (reconcileLive reader + route).
- [ ] Commit: `git add -A && git commit -m "feat(reconcile): wire reconcile panel+banner + docs (DQ-1)"`

---

## Feature: DQ-2 — Wire FX failure into token_failures + WhatsApp alert
Impact: high · Effort: S · CAPI-safe: yes (alert is WhatsApp template, not pixel/CAPI) · Depends on: none.
`'fx'` is already a `TokenFailureProvider`. The TikTok-FX catch in `cronDaily.ts` (~line 832) only `console.warn`s. We call `notifyTokenFailure` there so an FX outage that carries yesterday's rate forward produces a `token_failures` row (→ visible on `/operator > בעיות טוקן`) and a throttled WhatsApp alert.

### Task 1 — fail the test: cronDaily TikTok-FX catch records a token failure
- [ ] Locate the existing cronDaily test file: `grep -rl "cronDaily\|cron-daily\|persist-batch" dashboard-web/src/inngest/functions/__tests__/`. Add a focused test (new file if none fits) `dashboard-web/src/inngest/functions/__tests__/cronDailyFxAlert.test.ts` that:
  - mocks `@/lib/fetchers/fx` `getFxRate` to throw,
  - mocks `@/lib/notifications/tokenFailures` `notifyTokenFailure` with a `vi.fn()`,
  - drives the persist-batch FX branch with a non-CAD TikTok spend > 0,
  - asserts `notifyTokenFailure` was called once with `{ provider: 'fx', storeId: <store>, operation: expect.stringContaining('tiktok'), errorMsg: expect.any(String), advice: expect.any(String) }`.
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  const notifyTokenFailure = vi.fn(async () => ({ alerted: false, throttled: false, dbWritten: true }));
  vi.mock('@/lib/notifications/tokenFailures', () => ({ notifyTokenFailure }));
  vi.mock('@/lib/fetchers/fx', () => ({ getFxRate: vi.fn(async () => { throw new Error('frankfurter 503'); }) }));
  // import the smallest exported unit that runs the FX→CAD branch. If the branch
  // is inline in step.run('persist-batch'), refactor it into an exported pure-ish
  // helper `resolveTtSpendCad({ tiktokSpend, dateStr, storeId })` in cronDaily.ts
  // (or a new cronDaily/ttFx.ts) FIRST so it is unit-testable — mirror how
  // chooseTikTokSpendCad is already extracted.
  ```
- [ ] Run: `npx vitest run dashboard-web/src/inngest/functions/__tests__/cronDailyFxAlert.test.ts` → expected FAIL (no `notifyTokenFailure` call today).
- [ ] Refactor for testability (if needed): extract the `tiktok.spend > 0` FX→CAD try/catch (cronDaily.ts lines ~822-839) into an exported helper that the persist-batch step calls. Keep the existing soft-fail semantics (return `null` on failure so ON CONFLICT preserves the prior value) — do NOT change the data behaviour.
- [ ] Minimal impl — inside the catch (currently `console.warn(...)` at lines ~833-837), add (keep the console.warn too):
  ```ts
  // DQ-2: FX is a first-class token_failures provider — record + throttled
  // WhatsApp so a Frankfurter outage that silently carries yesterday's TikTok
  // (USD) rate forward into today's CAD is no longer invisible. Soft-fail by
  // construction (notifyTokenFailure never throws); the FX preserve-prior
  // behaviour below is unchanged.
  void notifyTokenFailure({
    provider: 'fx',
    storeId,
    operation: `cron_daily_tiktok_fx`,
    errorMsg: e instanceof Error ? e.message : String(e),
    advice: 'FX provider (Frankfurter) outage — TikTok spend kept yesterday\'s rate. Check api.frankfurter.dev; data_daily.tt_spend_cad preserved prior value.',
  });
  ```
  (`storeId` is in scope in the persist-batch closure; import `notifyTokenFailure` at the top of cronDaily.ts.)
- [ ] Run: `npx vitest run dashboard-web/src/inngest/functions/__tests__/cronDailyFxAlert.test.ts` → expected PASS.
- [ ] Commit: `git add -A && git commit -m "fix(fx): cron-daily TikTok FX failure records token_failures + WhatsApp alert (DQ-2)"`

### Task 2 — same wire for the manualOverrides FX path (override currency unconvertible)
- [ ] Note: `mergeOverridesFromSupabase` calls `getFxRate` in `overrideToCad`/`spendToCad` and THROWS on FX failure for an override (intentional — operator value is authoritative). That throw propagates and fails the run, which IS visible in the jobs table, but does NOT produce a `token_failures` row. Decide with the operator (see Open Questions) whether to also `notifyTokenFailure({ provider: 'fx', operation: 'cron_daily_override_fx' })` before re-throwing. If yes:
- [ ] Write failing test `dashboard-web/src/lib/fetchers/__tests__/manualOverridesFxAlert.test.ts` mocking `getFxRate` to throw on a non-CAD override row and asserting `notifyTokenFailure` is called with `provider: 'fx'` before the error re-throws.
- [ ] Run → FAIL → implement (wrap the `overrideToCad` call site in a try/catch that records then re-throws) → run → PASS.
- [ ] Commit: `git add -A && git commit -m "fix(fx): manual-override FX failure also records token_failures before failing the run (DQ-2)"`
  (If the operator says "leave override FX throwing as-is", SKIP this task and note it in Self-Review.)

---

## Feature: DQ-3 — Flag manual ad-spend overrides on Home/P&L numbers + add edit audit columns
Impact: medium · Effort: M · CAPI-safe: yes · Depends on: none.
Manual overrides silently rewrite spend/ROAS/profit. We (a) add `updated_at`/`created_by`/`applies_to` audit columns to `manual_overrides`, (b) read which platforms/stores are currently override-driven for the active range, and (c) render an inline "ידני" flag on the affected hero + P&L cells with a tooltip showing the override note + when it was last edited.

### Task 1 — migration: manual_overrides audit columns
- [ ] Write the migration `supabase/migrations/20260604130000_manual_overrides_audit_cols.sql`:
  ```sql
  -- DQ-3 (2026-06-04): edit-audit columns for manual_overrides. Additive +
  -- idempotent; existing rows keep created_at and get NULL audit fields.
  -- No re-backfill required (new columns are nullable); a future override edit
  -- populates updated_at via the operator CRUD upsert.
  ALTER TABLE manual_overrides
    ADD COLUMN IF NOT EXISTS updated_at  timestamptz,
    ADD COLUMN IF NOT EXISTS created_by  text,
    ADD COLUMN IF NOT EXISTS applies_to  text;  -- free-text: which displayed figure this currently overrides
  COMMENT ON COLUMN manual_overrides.updated_at IS 'DQ-3 — last edit time; null on rows created before this column existed.';
  COMMENT ON COLUMN manual_overrides.applies_to IS 'DQ-3 — operator note of which displayed metric this override currently rewrites (e.g. "uzoshop Meta spend").';
  ```
- [ ] Apply with the migration procedure above (hide .env, move the 2 gap files, `supabase db push`, restore).
- [ ] Verify applied: `supabase db push` succeeds; spot-check via a SELECT that the columns exist (or read `\d manual_overrides` through the Supabase SQL editor). No automated test for the DDL itself.
- [ ] Update `docs/ARCHITECTURE.md` (manual_overrides now carries audit cols).
- [ ] Commit: `git add -A && git commit -m "feat(overrides): add updated_at/created_by/applies_to audit cols to manual_overrides (DQ-3)"`

### Task 2 — `fetchManualOverridesForRange` reader
- [ ] Write failing test `dashboard-web/src/lib/__tests__/fetchManualOverridesForRange.test.ts` mocking `getSupabase()` to return 2 override rows (one Meta uzoshop, one TikTok zolplus) overlapping the range; assert the reader returns normalized `{ date, storeName, platform, spend, currency, notes, updatedAt }[]` projected to DISPLAY store names (mirror the `STORE_NAME_BY_ID` projection used by `fetchCohortMonthlyFromPostgres`).
- [ ] Run: `npx vitest run dashboard-web/src/lib/__tests__/fetchManualOverridesForRange.test.ts` → expected FAIL.
- [ ] Minimal impl: add `fetchManualOverridesForRange({ from, to })` to `postgresReaders.ts` — `getSupabase().from('manual_overrides').select('date,store_id,platform,spend,currency,notes,updated_at').gte('date', from).lte('date', to)`, project store_id → display name, coerce numerics via `toNumber`.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(overrides): fetchManualOverridesForRange reader (DQ-3)"`

### Task 3 — `overridesActive` pure helper
- [ ] Write failing test `dashboard-web/src/lib/home/__tests__/overridesActive.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { overridesActive } from '@/lib/home/overridesActive';
  it('marks the platform/store as override-driven when an override overlaps the range', () => {
    const res = overridesActive(
      [{ date: '2026-06-03', storeName: 'uzoshop', platform: 'meta', spend: 100, currency: 'ILS', notes: 'account outage', updatedAt: '2026-06-03T09:00:00Z' }],
      { from: '2026-06-01', to: '2026-06-04' },
    );
    expect(res.anyActive).toBe(true);
    expect(res.byStorePlatform['uzoshop::meta']).toBeTruthy();
    expect(res.byStorePlatform['uzoshop::meta'].notes).toBe('account outage');
  });
  it('returns anyActive=false for an empty list', () => {
    expect(overridesActive([], { from: '2026-06-01', to: '2026-06-04' }).anyActive).toBe(false);
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/home/__tests__/overridesActive.test.ts` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/home/overridesActive.ts` — filter rows to the range, key by `${storeName}::${platform}`, return `{ anyActive: boolean, byStorePlatform: Record<string, { notes: string | null; updatedAt: string | null }> }`.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(overrides): overridesActive range helper (DQ-3)"`

### Task 4 — `/api/active-overrides` shim
- [ ] Write failing test `dashboard-web/src/app/api/active-overrides/__tests__/route.test.ts` mocking `fetchManualOverridesForRange`; assert 200 + rows, and 200 soft-fail with `error` on throw, and a 400 on bad range params (reuse `parseRangeParams`/`RangeParamError` like `/api/data`).
- [ ] Run → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/app/api/active-overrides/route.ts` — parse range via `parseRangeParams` (mirror `/api/data` 400 path), call `fetchManualOverridesForRange`, soft-fail 200 with `{ rows: [], error }`. `Cache-Control: no-store` on the error path.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(overrides): /api/active-overrides range reader shim (DQ-3)"`

### Task 5 (mockup) — OverrideFlag chip mockup
- [ ] Add an `OverrideFlag` example to `docs/superpowers/mockups/2026-06-04-data-trust/flags.html` (shared mockup file for DQ-3 + DQ-4): the "ידני" chip sitting next to a hero spend number + on a P&L line, light + dark, with the tooltip preview.
- [ ] Deliver: `open docs/superpowers/mockups/2026-06-04-data-trust/flags.html`.
- [ ] STOP — operator approval before building. (Same mockup file is reused by DQ-4 Task 4; build both flags after one approval if the operator approves the combined sheet.)

### Task 6 — `<OverrideFlag>` primitive
- [ ] Write failing test `dashboard-web/src/components/ui/__tests__/OverrideFlag.dom.test.tsx`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { OverrideFlag } from '@/components/ui/OverrideFlag';
  it('renders the ידני chip with the override note in the tooltip content', () => {
    render(<OverrideFlag notes="account outage" updatedAt="2026-06-03T09:00:00Z" />);
    expect(screen.getByText('ידני')).toBeInTheDocument();
  });
  it('renders nothing when active is false-equivalent (no notes & no updatedAt & explicit hidden)', () => {
    const { container } = render(<OverrideFlag hidden />);
    expect(container).toBeEmptyDOMElement();
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/ui/__tests__/OverrideFlag.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/ui/OverrideFlag.tsx` — `<HelpTooltip content={…note + 'נערך: <relative updatedAt>'}>` wrapping a `<Badge tone="warning">ידני</Badge>`. Props `{ notes?: string | null; updatedAt?: string | null; hidden?: boolean }`. Token-only, no native title (uses HelpTooltip).
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(overrides): OverrideFlag primitive (DQ-3)"`

### Task 7 — render OverrideFlag on hero + P&L
- [ ] In `Dashboard.tsx` (HomeTab), SWR-fetch `/api/active-overrides` for the active range, compute `overridesActive(...)`, and pass a small `overrides` prop into `<CommandCenterHero>` (new optional prop) so the Spend / Operating-Profit / ROAS cards render `<OverrideFlag>` when their store/platform is override-driven. Add the matching prop + render to `CommandCenterHero.tsx` (in `HeroCardHeader` or next to the number). For the business-wide hero, flag when ANY platform is override-driven.
- [ ] Pass the same data into `PnLBreakdown.tsx`; render `<OverrideFlag>` on the ad-spend line(s) that are override-driven.
- [ ] Extend `CommandCenterHero.dom.test.tsx` with a case: passing `overrides={{ 'uzoshop::meta': { notes, updatedAt } }}` renders an "ידני" chip; absence renders none. Add the analogous case to `PnLBreakdown`'s DOM test.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home/__tests__/CommandCenterHero.dom.test.tsx dashboard-web/src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx` → expected PASS.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (the "ידני" flag).
- [ ] Commit: `git add -A && git commit -m "feat(overrides): surface ידני override flag on Home hero + P&L (DQ-3)"`

---

## Feature: DQ-4 — "live estimate vs finalized" provenance marker on Home/P&L
Impact: medium · Effort: M · CAPI-safe: yes · Depends on: none.
`data_daily.is_finalized`/`source` exist but are not projected to the readers, so Home/P&L can't tell a 10-min live-tick estimate from the nightly finalized reconcile. We project the columns, map them to a verdict, and render an "אומדן חי" (live estimate) chip when the active range contains any non-finalized day.

### Task 1 — project provenance columns into the daily reader
- [ ] Write failing test `dashboard-web/src/lib/__tests__/fetchDailyProvenance.test.ts` mocking `getSupabase()` to return a data_daily row with `is_finalized: false, source: 'live_tick', last_live_tick_at: '…', reconciled_at: null`; assert `fetchDailyDataFromPostgres` maps them onto the `DailyRow` as `isFinalized: false, source: 'live_tick', lastLiveTickAt: '…', reconciledAt: null`. Add a second row `is_finalized: true, source: 'daily_reconcile'` and assert it maps through.
- [ ] Run: `npx vitest run dashboard-web/src/lib/__tests__/fetchDailyProvenance.test.ts` → expected FAIL (fields not selected/mapped today).
- [ ] Minimal impl:
  - In `postgresReaders.ts` add `is_finalized, source, last_live_tick_at, reconciled_at` to the `fetchDailyDataFromPostgres` select string (line ~291-295).
  - Map them onto each `DailyRow` push: `isFinalized: Boolean(r.is_finalized)`, `source: r.source == null ? null : String(r.source)`, `lastLiveTickAt: r.last_live_tick_at ? String(r.last_live_tick_at) : null`, `reconciledAt: r.reconciled_at ? String(r.reconciled_at) : null`.
  - In `types.ts` add the four optional fields to `DailyRow`.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(provenance): project is_finalized/source/last_live_tick_at/reconciled_at into DailyRow (DQ-4)"`

### Task 2 — `provenanceForRange` pure mapper
- [ ] Write failing test `dashboard-web/src/lib/freshness/__tests__/provenance.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { provenanceForRange } from '@/lib/freshness/provenance';
  it('reports live-estimate when any day is not finalized', () => {
    const res = provenanceForRange([
      { isFinalized: true, source: 'daily_reconcile', lastLiveTickAt: null },
      { isFinalized: false, source: 'live_tick', lastLiveTickAt: '2026-06-04T11:50:00Z' },
    ]);
    expect(res.allFinalized).toBe(false);
    expect(res.verdict).toBe('live_estimate');
  });
  it('reports finalized when every day is finalized', () => {
    const res = provenanceForRange([{ isFinalized: true, source: 'daily_reconcile', lastLiveTickAt: null }]);
    expect(res.allFinalized).toBe(true);
    expect(res.verdict).toBe('finalized');
  });
  it('reports unknown for empty / missing-provenance rows (back-compat with pre-migration rows)', () => {
    expect(provenanceForRange([]).verdict).toBe('unknown');
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/freshness/__tests__/provenance.test.ts` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/freshness/provenance.ts` — accept rows with optional `isFinalized`/`source`/`lastLiveTickAt`; return `{ allFinalized: boolean; anyLiveTick: boolean; verdict: 'finalized' | 'live_estimate' | 'unknown' }`. `unknown` when no rows carry a defined `isFinalized` (pre-migration rows / empty).
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(provenance): provenanceForRange verdict mapper (DQ-4)"`

### Task 3 (mockup) — ProvenanceFlag in the shared flags mockup
- [ ] Add the "אומדן חי" chip example to `docs/superpowers/mockups/2026-06-04-data-trust/flags.html` (the same sheet as DQ-3's OverrideFlag) — on a hero number and a P&L line, light + dark, with the tooltip ("מבוסס על tick חי כל ~10 דק׳; ננעל סופית בריקונסיילי הלילה").
- [ ] Deliver: `open docs/superpowers/mockups/2026-06-04-data-trust/flags.html`.
- [ ] STOP — operator approval (combine with DQ-3 approval if presented together).

### Task 4 — `<ProvenanceFlag>` primitive
- [ ] Write failing test `dashboard-web/src/components/ui/__tests__/ProvenanceFlag.dom.test.tsx`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { ProvenanceFlag } from '@/components/ui/ProvenanceFlag';
  it('renders אומדן חי for live_estimate', () => {
    render(<ProvenanceFlag verdict="live_estimate" />);
    expect(screen.getByText('אומדן חי')).toBeInTheDocument();
  });
  it('renders nothing for finalized', () => {
    const { container } = render(<ProvenanceFlag verdict="finalized" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing for unknown', () => {
    const { container } = render(<ProvenanceFlag verdict="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/ui/__tests__/ProvenanceFlag.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/ui/ProvenanceFlag.tsx` — props `{ verdict: 'finalized' | 'live_estimate' | 'unknown'; lastLiveTickAt?: string | null }`; render the chip ONLY for `live_estimate` (a `<Badge tone="info">אומדן חי</Badge>` wrapped in `<HelpTooltip>`); return `null` otherwise. Token-only.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(provenance): ProvenanceFlag primitive (DQ-4)"`

### Task 5 — render ProvenanceFlag on hero + P&L
- [ ] In `Dashboard.tsx` (HomeTab) compute `provenanceForRange(rows-in-range-for-current-scope)` and pass `provenance` into `<CommandCenterHero>` (new optional prop) → render `<ProvenanceFlag>` in the featured Operating-Profit header. Pass the same verdict to `PnLBreakdown.tsx` → render near the spend/net-profit header.
- [ ] Extend the hero + P&L DOM tests: `provenance="live_estimate"` renders "אומדן חי"; `"finalized"` renders none.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home/__tests__/CommandCenterHero.dom.test.tsx dashboard-web/src/components/__tests__/PnLBreakdownSalaries.dom.test.tsx` → expected PASS.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (the "אומדן חי" marker).
- [ ] Commit: `git add -A && git commit -m "feat(provenance): surface live-estimate vs finalized on Home hero + P&L (DQ-4)"`

---

## Feature: DQ-5 — Source-level freshness/missing-source signal on the dashboard
Impact: medium · Effort: M · CAPI-safe: yes · Depends on: none.
The `data_freshness` status matrix (success/budget_skip/transient_error/auth_error/parse_error + lag) is operator-only. The Home desaturation chip conveys "old" but not "Meta auth_error" or "Google 6h stale". We add a compact per-(store,platform) rollup reader + a Home chip that surfaces an unhealthy source.

### Task 1 — `sourceStatusRollup` pure mapper
- [ ] Write failing test `dashboard-web/src/lib/freshness/__tests__/sourceStatus.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { sourceStatusRollup } from '@/lib/freshness/sourceStatus';
  const base = { last_attempt_at: '', last_success_at: null, error_code: null, error_message: null, budget_skip: false, updated_at: '', scope: 'kpi_daily', table_name: 'data_daily' };
  it('flags the worst non-success status per store×platform', () => {
    const res = sourceStatusRollup([
      { ...base, store_id: 'uzoshop', platform: 'meta', status: 'auth_error', lag_minutes: 120 },
      { ...base, store_id: 'uzoshop', platform: 'meta', status: 'success', lag_minutes: 0 },
      { ...base, store_id: 'uzoshop', platform: 'google', status: 'success', lag_minutes: 0 },
    ]);
    expect(res.anyUnhealthy).toBe(true);
    expect(res.unhealthy[0]).toMatchObject({ storeId: 'uzoshop', platform: 'meta', status: 'auth_error', lagMinutes: 120 });
  });
  it('returns anyUnhealthy=false when every row is success (budget_skip is NOT unhealthy)', () => {
    const res = sourceStatusRollup([
      { ...base, store_id: 'uzoshop', platform: 'meta', status: 'success', lag_minutes: 0 },
      { ...base, store_id: 'uzoshop', platform: 'meta', status: 'budget_skip', lag_minutes: 5 },
    ]);
    expect(res.anyUnhealthy).toBe(false);
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/freshness/__tests__/sourceStatus.test.ts` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/freshness/sourceStatus.ts` — group `FreshnessRow[]` by `${store_id}::${platform}`, treat `success` and `budget_skip` as healthy (budget_skip is a proactive pre-emption, not an outage — consistent with `tokenFailures.ts` semantics), pick the worst non-success status per group, return `{ anyUnhealthy: boolean; unhealthy: { storeId; platform; status; lagMinutes }[] }`.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(freshness): sourceStatusRollup per store×platform worst-status mapper (DQ-5)"`

### Task 2 — `/api/freshness-summary` shim
- [ ] Write failing test `dashboard-web/src/app/api/freshness-summary/__tests__/route.test.ts` mocking `getFreshness` → assert 200 + the rollup shape, and soft-fail 200 with `error` on throw.
- [ ] Run → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/app/api/freshness-summary/route.ts` — `runtime nodejs`, `force-dynamic`; call `getFreshness()` (lib/inngest/freshness), apply `sourceStatusRollup`, return `{ anyUnhealthy, unhealthy, lastUpdated }`; soft-fail 200 mirror.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(freshness): /api/freshness-summary rollup shim for the dashboard (DQ-5)"`

### Task 3 (mockup) — SourceHealthChip mockup
- [ ] Add `docs/superpowers/mockups/2026-06-04-data-trust/source-health.html` — the Home chip in 3 states (all green → hidden; "Meta · auth_error"; "Google · 6h"), light + dark, with the tooltip linking to /operator.
- [ ] Deliver: `open docs/superpowers/mockups/2026-06-04-data-trust/source-health.html`.
- [ ] STOP — operator approval before building.

### Task 4 — `<SourceHealthChip>` component
- [ ] Write failing test `dashboard-web/src/components/home/__tests__/SourceHealthChip.dom.test.tsx`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  vi.mock('swr', async () => ({ default: () => ({ data: { anyUnhealthy: true, unhealthy: [{ storeId: 'uzoshop', platform: 'meta', status: 'auth_error', lagMinutes: 120 }], lastUpdated: '' }, isLoading: false }) }));
  import { SourceHealthChip } from '@/components/home/SourceHealthChip';
  it('renders the unhealthy source label', () => {
    render(<SourceHealthChip />);
    expect(screen.getByText(/meta/i)).toBeInTheDocument();
    expect(screen.getByText(/auth_error/)).toBeInTheDocument();
  });
  ```
  (Add a sibling describe mocking `anyUnhealthy: false` asserting the container is empty.)
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home/__tests__/SourceHealthChip.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/home/SourceHealthChip.tsx` — SWR over `/api/freshness-summary` (15s); when `!anyUnhealthy` return `null`; else render a `<Badge tone="danger">` per unhealthy source with "<platform> · <status>" + lag, wrapped in a `<HelpTooltip>` pointing to /operator. Reuse the `statusTextClass` token palette idea from `FreshnessPanel`. Token-only, logical classes.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(freshness): SourceHealthChip surfaces unhealthy sources on Home (DQ-5)"`

### Task 5 — wire into Home + docs
- [ ] Render `<SourceHealthChip>` in the Home tab near `<TabFreshnessHeader>` (so age + source-status sit together). Confirm no regression: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/home`.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (source-health chip) + `docs/ARCHITECTURE.md` (freshness-summary reader).
- [ ] Commit: `git add -A && git commit -m "feat(freshness): wire SourceHealthChip + docs (DQ-5)"`

---

## Feature: DQ-6 — Cohort/LTV "as-of" freshness on the Customers tab
Impact: low · Effort: S · CAPI-safe: yes · Depends on: none.
`cronCohortRefresh` runs weekly (Mon 04:00 IL); the Customers tab can be 6 days stale with no marker. We record the cohort refresh's last success time and surface "עודכן: <date>" with a stale tooltip.

### Task 1 — migration/marker: cohort refresh as-of
- [ ] Write the migration `supabase/migrations/20260604140000_cohort_refresh_meta.sql` — reuse the existing `data_freshness` table (it already has `last_success_at`); no new table needed, so this migration is OPTIONAL. Prefer recording into `data_freshness` via `recordFreshness({ storeId, platform: 'shopify', scope: 'cohort_monthly', tableName: 'customer_cohort_monthly', status: 'success' })`. If the operator prefers a dedicated single-row marker, the migration creates `cohort_refresh_meta(id smallint primary key default 1, last_success_at timestamptz)` — but DEFAULT to the `data_freshness` reuse and SKIP the migration (note in Self-Review). Decision in Open Questions.
- [ ] If reusing `data_freshness`: no migration, no test for DDL. Proceed to Task 2.
- [ ] Commit (only if a migration is written): `git add -A && git commit -m "feat(cohorts): cohort_refresh as-of marker (DQ-6)"`

### Task 2 — record freshness on cohort refresh success
- [ ] Write failing test `dashboard-web/src/inngest/functions/__tests__/cronCohortRefreshFreshness.test.ts` mocking `recordFreshness` (`@/lib/inngest/freshness`); drive a per-store success path and assert `recordFreshness` was called with `{ scope: 'cohort_monthly', tableName: 'customer_cohort_monthly', status: 'success', storeId }`.
  (Inspect `cronCohortRefresh.ts` per-store loop to find the post-write success point; if the success branch is inline in a step, extract the minimal recordable unit or call `recordFreshness` right after the upsert step resolves.)
- [ ] Run: `npx vitest run dashboard-web/src/inngest/functions/__tests__/cronCohortRefreshFreshness.test.ts` → expected FAIL.
- [ ] Minimal impl: in `cronCohortRefresh.ts`, after each store's successful full-replace upsert, call `await recordFreshness({ storeId, platform: 'shopify', scope: 'cohort_monthly', tableName: 'customer_cohort_monthly', status: 'success' })` (soft-fail by construction; import it). On the per-store soft-fail catch, record the matching error status.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(cohorts): cron-cohort-refresh records data_freshness as-of (DQ-6)"`

### Task 3 — expose `asOf` on `/api/cohorts`
- [ ] Write failing test `dashboard-web/src/app/api/cohorts/__tests__/route.test.ts` (extend if it exists) — mock `fetchCohortMonthlyFromPostgres` AND a new `fetchCohortAsOf()` reader; assert the response body carries `asOf: '<iso>'`.
- [ ] Run → expected FAIL.
- [ ] Minimal impl: add `fetchCohortAsOf()` to `postgresReaders.ts` — read the max `last_success_at` from `data_freshness` where `scope = 'cohort_monthly'`; wire it into `/api/cohorts/route.ts` and add `asOf: string | null` to `CohortsResponse`. Keep soft-fail (asOf `null` on error).
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(cohorts): /api/cohorts returns asOf from data_freshness (DQ-6)"`

### Task 4 (mockup) — CohortAsOfBadge mockup
- [ ] Add `docs/superpowers/mockups/2026-06-04-data-trust/cohort-asof.html` — the badge in fresh (≤7d) and stale (>7d) states, in the Customers-tab SectionIntro context, light + dark.
- [ ] Deliver: `open docs/superpowers/mockups/2026-06-04-data-trust/cohort-asof.html`.
- [ ] STOP — operator approval.

### Task 5 — `<CohortAsOfBadge>` + wire into CustomerValueTab
- [ ] Write failing test `dashboard-web/src/components/__tests__/CohortAsOfBadge.dom.test.tsx`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { CohortAsOfBadge } from '@/components/CohortAsOfBadge';
  it('renders the as-of date', () => {
    render(<CohortAsOfBadge asOf="2026-06-02T04:00:00Z" now={Date.parse('2026-06-04T10:00:00Z')} />);
    expect(screen.getByText(/עודכן/)).toBeInTheDocument();
  });
  it('renders a stale tone when older than 7 days', () => {
    render(<CohortAsOfBadge asOf="2026-05-20T04:00:00Z" now={Date.parse('2026-06-04T10:00:00Z')} />);
    expect(screen.getByText(/עודכן/)).toBeInTheDocument(); // tooltip/tone asserts age>7d path
  });
  it('renders — when asOf is null', () => {
    render(<CohortAsOfBadge asOf={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/__tests__/CohortAsOfBadge.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/CohortAsOfBadge.tsx` — props `{ asOf: string | null; now?: number }`; format "עודכן: DD/MM" (Israel TZ, like `FreshnessPanel.formatRelative`); `Badge tone="info"` when ≤7d, `tone="warning"` + a "נתוני קוהורט מתעדכנים שבועית (שני 04:00)" tooltip when >7d; "—" when null. Token-only.
- [ ] Wire: read `asOf` from the cohorts SWR response in `CustomerValueTab.tsx` and render `<CohortAsOfBadge asOf={data?.asOf ?? null} />` inside the `SectionIntro` region.
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/__tests__/CohortAsOfBadge.dom.test.tsx dashboard-web/src/components/__tests__/CustomerValueTab.dom.test.tsx` → expected PASS.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (cohort as-of badge).
- [ ] Commit: `git add -A && git commit -m "feat(cohorts): CohortAsOfBadge on Customers tab (DQ-6)"`

---

## Feature: DQ-7 — Live TikTok shared-account mapping-coverage signal
Impact: medium · Effort: M · CAPI-safe: yes · Depends on: none (but reads `campaignStoreMap` which is shared — see "Mapping-aware" constraint).
The only TikTok-shared-account trust signal is a static disclaimer. We compute, from the TikTok account total + Σ mapped campaigns + the store map, how many campaigns this period are UNMAPPED (defaulting to uzoshop) and the unattributed spend (`account − Σmapped`), and surface it as a live operator panel under the disclaimer.

### Task 1 — `tiktokCoverage` pure helper
- [ ] Write failing test `dashboard-web/src/lib/audit/__tests__/tiktokCoverage.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { tiktokCoverage } from '@/lib/audit/tiktokCoverage';
  it('computes unmapped campaigns + unattributed spend (account − Σmapped)', () => {
    const res = tiktokCoverage({
      accountTotalCad: 100,
      campaigns: [
        { campaignId: 'c1', advertiserId: 'a1', spendCad: 40 },
        { campaignId: 'c2', advertiserId: 'a1', spendCad: 30 },
      ],
      storeMap: { 'tiktok::a1::c1': 'zolplus' }, // c2 unmapped → defaults to uzoshop
      defaultStoreId: 'uzoshop',
    });
    expect(res.mappedSpendCad).toBe(70);
    expect(res.unattributedSpendCad).toBeCloseTo(30); // 100 account − 70 per-campaign
    expect(res.unmappedCampaignIds).toEqual(['c2']);
  });
  it('reports zero unmapped + zero unattributed when every campaign is mapped and sums to the account total', () => {
    const res = tiktokCoverage({
      accountTotalCad: 70,
      campaigns: [{ campaignId: 'c1', advertiserId: 'a1', spendCad: 70 }],
      storeMap: { 'tiktok::a1::c1': 'zolplus' },
      defaultStoreId: 'uzoshop',
    });
    expect(res.unmappedCampaignIds).toHaveLength(0);
    expect(res.unattributedSpendCad).toBe(0);
  });
  ```
- [ ] Run: `npx vitest run dashboard-web/src/lib/audit/__tests__/tiktokCoverage.test.ts` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/lib/audit/tiktokCoverage.ts` — use `campaignStoreKey` from `@/lib/campaignStoreMap` to test each campaign's mapping; `unmappedCampaignIds` = campaigns with no map entry; `mappedSpendCad` = Σ per-campaign spend; `unattributedSpendCad` = `max(0, accountTotalCad − mappedSpendCad)` (the account-vs-Σcampaigns gap that INV-7 deliberately tolerates for TikTok — reconcile.ts lines 109-116). Return `{ unmappedCampaignIds, mappedSpendCad, unattributedSpendCad }`.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(tiktok): tiktokCoverage mapping/unattributed-spend helper (DQ-7)"`

### Task 2 — `fetchTikTokCoverageInputs` reader
- [ ] Write failing test `dashboard-web/src/lib/__tests__/fetchTikTokCoverageInputs.test.ts` mocking `getSupabase()` to return (a) data_daily TikTok account total for the window and (b) campaigns_daily TikTok rows; assert it returns `{ accountTotalCad, campaigns: [{ campaignId, advertiserId, spendCad }] }`. (Read mapping-aware: `accountTotalCad` from `data_daily.tt_spend_cad` summed for the window; `campaigns` from `campaigns_daily` TikTok rows for the window.)
- [ ] Run → expected FAIL.
- [ ] Minimal impl: add `fetchTikTokCoverageInputs({ from, to })` to `postgresReaders.ts` — sum `data_daily.tt_spend_cad` over the window for the account total; select TikTok `campaigns_daily` rows (`campaign_id, advertiser_id, spend_cad`) for the window. Coerce via `toNumber`. (The store map is client-side localStorage/dashboard_state; pass it in from the client, OR read `dashboard_state` server-side — see Open Questions. Default: the reader returns the two server facts; the panel reads the store map from `readCampaignStoreMap()` client-side.)
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(tiktok): fetchTikTokCoverageInputs reader (account total + per-campaign spend) (DQ-7)"`

### Task 3 — `/api/operator/tiktok-coverage` shim
- [ ] Write failing test `dashboard-web/src/app/api/operator/tiktok-coverage/__tests__/route.test.ts` mocking `fetchTikTokCoverageInputs`; assert 200 + the inputs payload, and soft-fail 200 with `error` on throw. (The route returns the raw inputs; the panel applies `tiktokCoverage` with the client-side store map — keeps the route store-map-agnostic.)
- [ ] Run → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/app/api/operator/tiktok-coverage/route.ts` — `runtime nodejs`, `force-dynamic`; default window = today + yesterday (via `lib/dateRange`); soft-fail 200 mirror.
- [ ] Run → expected PASS.
- [ ] Commit: `git add -A && git commit -m "feat(tiktok): /api/operator/tiktok-coverage shim (DQ-7)"`

### Task 4 (mockup) — TikTokCoveragePanel mockup
- [ ] Add `docs/superpowers/mockups/2026-06-04-data-trust/tiktok-coverage.html` — the panel showing "N קמפיינים לא ממופים (יורדים ל-uzoshop)", "הוצאה לא משויכת = $X (חשבון − Σממופה)", and a per-campaign list, light + dark; plus the existing static disclaimer ABOVE it (kept).
- [ ] Deliver: `open docs/superpowers/mockups/2026-06-04-data-trust/tiktok-coverage.html`.
- [ ] STOP — operator approval.

### Task 5 — `<TikTokCoveragePanel>` + wire under the disclaimer
- [ ] Write failing test `dashboard-web/src/components/operator/__tests__/TikTokCoveragePanel.dom.test.tsx`:
  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  vi.mock('@/lib/operatorClient', () => ({
    operatorFetch: vi.fn(async () => ({
      json: async () => ({ accountTotalCad: 100, campaigns: [{ campaignId: 'c2', advertiserId: 'a1', spendCad: 30 }] }),
    })),
  }));
  vi.mock('@/lib/campaignStoreMap', async (orig) => {
    const actual = await orig() as object;
    return { ...actual, readCampaignStoreMap: () => ({}) }; // c2 unmapped
  });
  import { TikTokCoveragePanel } from '@/components/operator/TikTokCoveragePanel';
  it('shows the unmapped campaign count and unattributed spend', async () => {
    render(<TikTokCoveragePanel />);
    expect(await screen.findByText(/c2/)).toBeInTheDocument();
    expect(await screen.findByText(/70|30|100/)).toBeInTheDocument(); // mapped/unattributed/account via <Money>
  });
  ```
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/operator/__tests__/TikTokCoveragePanel.dom.test.tsx` → expected FAIL.
- [ ] Minimal impl `dashboard-web/src/components/operator/TikTokCoveragePanel.tsx` — SWR over `/api/operator/tiktok-coverage`; read `readCampaignStoreMap()` (client) + apply `tiktokCoverage` with `defaultStoreId: 'uzoshop'`; render the unmapped count, the unattributed spend via `<Money>`, and a `TableBase` of unmapped campaigns. Token-only, RTL, numbers via `<Money>`.
- [ ] Wire: add a section in `HealthTab.tsx` immediately BELOW the existing static TikTok disclaimer (keep the disclaimer — it documents the historical attribution; the panel adds the live ongoing-risk signal).
- [ ] Run: `npx vitest run --config vitest.config.dom.ts dashboard-web/src/components/operator/__tests__/TikTokCoveragePanel.dom.test.tsx` → expected PASS.
- [ ] Update `docs/ROAS-Dashboard-User-Manual.md` (TikTok coverage panel) + `docs/ARCHITECTURE.md` (coverage reader + route).
- [ ] Commit: `git add -A && git commit -m "feat(tiktok): live mapping-coverage panel under the static disclaimer (DQ-7)"`

---

## Final gate (run once, after all features)
- [ ] `cd dashboard-web && npx tsc --noEmit` → expected: no errors.
- [ ] `cd dashboard-web && npm run test` → expected: all pass.
- [ ] `cd dashboard-web && npm run test:components` → expected: all pass.
- [ ] `cd dashboard-web && npm run lint` → expected: clean (no `local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, `local/no-hex-color-in-components`, or green-ratchet violations).
- [ ] Docs-currency: confirm `docs/ROAS-Dashboard-User-Manual.md` has the new data-trust section AND `docs/ARCHITECTURE.md` documents the new readers/route/alert/migrations. Bump the User Manual version footer.
- [ ] Do NOT push — report completion to the operator and let them push.

---

## Self-Review

**Spec coverage** — every listed gap id is its own Feature with full TDD tasks:
- DQ-1 (reconcileLive reader + route + operator panel + Home banner) — 7 tasks incl. mockup-first.
- DQ-2 (FX failure → token_failures + WhatsApp) — 2 tasks (the 2nd, override-FX, is operator-gated).
- DQ-3 (override audit cols migration + reader + helper + shim + OverrideFlag on hero/P&L) — 7 tasks incl. mockup-first.
- DQ-4 (project provenance cols + verdict mapper + ProvenanceFlag on hero/P&L) — 5 tasks incl. mockup-first.
- DQ-5 (sourceStatusRollup + freshness-summary shim + SourceHealthChip on Home) — 5 tasks incl. mockup-first.
- DQ-6 (cohort as-of via data_freshness + /api/cohorts asOf + CohortAsOfBadge) — 5 tasks incl. mockup-first.
- DQ-7 (tiktokCoverage helper + reader + shim + TikTokCoveragePanel under the disclaimer) — 5 tasks incl. mockup-first.

**Placeholder scan** — every code block references REAL, verified symbols: `reconcileWindow`/`Violation` (reconcile.ts), `notifyTokenFailure`/`TokenFailureProvider`/`'fx'` (tokenFailures.ts line 45-51), the cronDaily FX catch (lines ~822-839), `mergeOverridesFromSupabase`/`overrideToCad` (manualOverrides.ts), `data_daily.is_finalized`/`source`/`last_live_tick_at`/`reconciled_at` (migration 20260530100002 — confirmed NOT in the `fetchDailyDataFromPostgres` select at lines 291-295, so DQ-4 Task 1 genuinely adds them), `getFreshness`/`FreshnessRow`/`recordFreshness` (lib/inngest/freshness.ts), `customer_cohort_monthly`/`CohortsResponse`/`fetchCohortMonthlyFromPostgres` (cohorts route + readers), `campaignStoreKey`/`readCampaignStoreMap`/`resolveStoreForCampaign` (campaignStoreMap.ts), `Card`/`Badge`/`Money`/`HelpTooltip`/`TableBase`/`FreshnessBadge` primitives (confirmed props), the `/api/operator/freshness` soft-fail pattern (route.ts), `parseRangeParams`/`RangeParamError` (api/data), `getTodayInIsraelTz` (dateRange.ts), `STORE_NAME_BY_ID` projection (readers). Two spots are intentionally "inspect-then-extract" rather than verbatim (the cronDaily persist-batch FX branch extraction for testability, and the cronCohortRefresh per-store success point) because those are inline-in-step closures whose exact line shape must be read at execution time — each carries a concrete instruction to extract a named helper mirroring the existing `chooseTikTokSpendCad`/`recordFreshness` patterns, not a TODO.

**Type consistency** — new types compose existing ones: `ReconcileResult` reuses `Violation`; `DailyRow` gains 4 optional fields (back-compat with pre-migration null rows via the `unknown` provenance verdict); `CohortsResponse` gains `asOf: string | null`; `FreshnessResponse`-style soft-fail shapes reused for all new shims; rollup/coverage helpers return plain object shapes pinned by their tests. All money rendered through `<Money>`; all status colours through `text-status-*`/`Badge tone`. No `any` introduced except the SWR/operatorFetch test mocks (matching existing test conventions).

**Hard-constraint check** — CAPI-safe (every feature is read/display; the only write is the additive `manual_overrides` audit cols + a `data_freshness` success row; the only outbound message is the existing WhatsApp token-failure template, never a pixel/CAPI event). Mockup-first applied to all 6 visible UI features (DQ-2 is backend-only, no mockup). Mapping-aware: DQ-4/DQ-7 read `data_daily`/`campaigns_daily` + `campaignStoreMap`, never raw account totals (the TikTok account total in DQ-7 is explicitly used to MEASURE the unattributed gap, not to attribute spend). All migrations are `ADD COLUMN IF NOT EXISTS`/`CREATE … IF NOT EXISTS`, nullable/defaulted, with the documented apply procedure.

## Open questions for the operator
1. **DQ-1 reconcile window** — today+yesterday is proposed for the live reconcile. Want a longer default (e.g. 3 days, matching the Refresh-All window) or a selectable range on the panel?
2. **DQ-1 known-expected gaps** — INV-9 fires legitimately on days with null-product-id (custom-item) refunds, and INV-7 TikTok under-report is tolerated by design. Should the panel auto-suppress/label those expected violations (so only NEW drift shows red), or show them all with an "expected" tag?
3. **DQ-2 override FX** — `mergeOverridesFromSupabase` currently THROWS on an unconvertible override currency (failing the run, visible in jobs). Add a `token_failures` row there too (Task 2 of DQ-2), or leave the throw-only behaviour?
4. **DQ-3 audit cols** — is `created_by` meaningful for a single-operator tool, or should we drop it and keep only `updated_at` + `applies_to`? Should the operator CRUD UI start writing `updated_at`/`applies_to` on every save (a tiny follow-up to ManualOverridesCrud)?
5. **DQ-4 staleness of "live estimate"** — should the "אומדן חי" chip ALSO appear when the range is purely historical but a row is still non-finalized (rare), or only for ranges including today?
6. **DQ-6 cohort as-of source** — reuse `data_freshness` (scope `cohort_monthly`) as proposed (no migration), or create a dedicated `cohort_refresh_meta` single-row table? Default is the `data_freshness` reuse.
7. **DQ-7 store-map source** — read the TikTok campaign→store map client-side (`readCampaignStoreMap()`, current localStorage/dashboard_state) inside the panel, or have the server read `dashboard_state` so the coverage number is identical regardless of which browser opened /operator? Default is client-side (matches where the map lives today).
8. **DQ-7 unattributed-spend threshold** — should an unattributed-spend % above some threshold escalate to a `token_failures`/WhatsApp alert (like budget_skip), or stay display-only on the operator panel?

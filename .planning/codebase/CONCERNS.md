# Codebase Concerns

**Analysis Date:** 2026-05-24
**Baseline:** `b846ae7` (HEAD after Phase 12)
**Supersedes:** prior CONCERNS.md (2026-05-18, pre-v1/v2/v3 audit and pre-Phase-11 Apps Script decommission)

This is the post-conversion, post-v3-audit honest snapshot. Multiple audit rounds
have closed the original concerns (Apps Script 6-min cap, missing test suite,
COGS duplication, last-write-wins cloud-sync, etc.) by either fixing the issue or
removing the surface entirely (Apps Script decommissioned in Phase 11).

The items below are what remains **OPEN** for future-claude and the operator. Each
item cites file:line + the audit finding ID + the commit that resolved or deferred
it.

---

## Tech Debt

### U-03 — `aiReport.ts` CV thresholds inlined as magic numbers (DEFERRED)

- **Issue:** The CV (coefficient of variation) bucket thresholds for stable /
  medium / volatile CPM are hardcoded as `0.15` and `0.35` directly in the
  classification expression instead of being hoisted as named constants. Sibling
  thresholds in `attributionAnalysis.ts` ARE hoisted (`STABLE_THRESHOLD` /
  `VOLATILE_THRESHOLD`), so there's a discoverability inconsistency.
- **Files:** `dashboard-web/src/lib/aiReport.ts:398, 400` (the ternary that maps
  CV → bucket); also referenced inline at `:387-388` (tooltip copy that mentions
  the same numbers).
- **Impact:** Cosmetic. Math is correct today. Future change to the thresholds
  requires editing 4 occurrences (2 in the ternary + the tooltip copy) instead
  of one constant. Easy to miss the tooltip and ship inconsistent UX.
- **Operator stance (Phase 9 triage):** "When you have time" — explicitly
  deferred. Not blocking.
- **Fix approach:** Hoist `STABLE_CV_MAX = 0.15` and `VOLATILE_CV_MIN = 0.35`
  at module top, replace inline usage, interpolate into the tooltip copy. ~5
  line change.
- **Target phase:** Polish pass (no dedicated phase needed).

---

### Per-platform constants still partially split across 3 files

- **Issue:** Phase 10 U-01 extracted `TIKTOK_ACTIVE_ENOUGH` to a shared
  `lib/platformConfig.ts` (commit `b919705`) consumed by both `cronLive.ts`
  (writer) and `postgresReaders.ts` (reader). That fixed the writer↔reader
  symmetry concern. However, other per-platform constants still live in their
  original modules:
  - `PLATFORM_ROAS_PIVOT` (Meta 3.0 / Google 3.5 / TikTok 2.0) in
    `campaignHealthScore.ts:141`
  - `PLATFORM_FALLBACK_TRUST` in `campaignHealthScore.ts` (sibling block)
  - `STORES_WITH_GOOGLE_ADS = new Set(['uzoshop'])` in
    `fetchers/googleAds.ts:73`
- **Files:** `dashboard-web/src/lib/campaignHealthScore.ts:141`,
  `dashboard-web/src/lib/fetchers/googleAds.ts:73`.
- **Impact:** None today — no consumer of these constants lives outside its
  owning module. Future-fragile: if a new module needs to know "is this a
  Google-Ads store?" it will either import from `fetchers/` (a layer cross
  the dashboard generally avoids) or duplicate the set.
- **Fix approach:** Move all 3 into `lib/platformConfig.ts` as the single
  source of truth for per-platform / per-store metadata. Update the audit's
  cross-surface observation #5 once done.
- **Target phase:** Polish pass during the next refactor that touches either
  file. Not blocking.

---

### Variance convention inconsistency (no doc justifying the asymmetry)

- **Issue:** Three statistical computations use different variance conventions
  without inline justification:
  - `attributionAnalysis.ts` AOV CI uses Bessel-corrected sample variance
    (correct — AOVs ARE a sample from an infinite future-purchases
    distribution).
  - `attributionAnalysis.ts` `computeWindowStability` uses POPULATION variance
    (defensible — the window IS the full population for that store-period).
  - `aiReport.ts` CV uses POPULATION variance (same reasoning as above).
- **Files:** `dashboard-web/src/lib/attributionAnalysis.ts:356, 861`
  (Bessel/sample); `dashboard-web/src/lib/attributionAnalysis.ts` window
  stability block; `dashboard-web/src/lib/aiReport.ts:373-377`.
- **Impact:** None mathematically — each call-site is defensible. But there's
  no shared `lib/stats.ts` exposing `sampleVariance` vs `populationVariance`
  with clear names, so a future contributor could easily mis-apply Bessel
  correction without realizing it's a deliberate choice.
- **Fix approach:** Extract a `lib/stats.ts` module with explicitly-named
  exports + JSDoc explaining when to use each. Migrate the 3 call-sites.
- **Target phase:** Polish pass. Not blocking.

---

## Known Bugs

**None open.** The only concrete bug from the v3 audit (B-01: `cronLive.ts`
return value dropped `tt` from `todaySpendCad`) was fixed in commit `48a2945`
(Phase 10). All prior-audit critical bugs (v1, v2, v3) are also closed.

---

## Resolved (cross-reference)

### U-05 — RESOLVED in Phase 12 (commit `b846ae7`)

- **Original concern:** `COVERAGE_UPPER_CLAMP = 2` in `attributionAnalysis.ts`
  silently capped extreme halo (coverage > 2×) without surfacing it to the
  operator. Truly anomalous attribution leaks were invisible.
- **Resolution:** Phase 12 changed the contract: the raw coverage value is
  now exposed, AND a "halo exceeded" warning chip renders when the value
  crosses the clamp threshold. Operator sees both the actual ratio and an
  explicit warning marker.
- **Commit:** `b846ae7` — `fix(attribution): show raw coverage + halo-exceeded warning chip (AUDIT U-05)`.
- **Status:** Closed. No follow-up needed.

---

## Test Coverage Gaps

### `aiReport.ts` statistics — PARTIALLY COVERED (Phase 10 C-01)

- **What was tested in Phase 10 (commit `adb0c17`):** Added oracle for
  `medianMad`, `stddev`, `CV`, `z-score`, and `momentum` computations in a
  new `__tests__/aiReportStatistics.test.ts`.
- **What remains untested:**
  - CV-threshold BUCKET BOUNDARIES at exactly `0.15` and `0.35` — Phase 10
    covered the math, not the categorization ternary at `aiReport.ts:398, 400`.
  - Funnel rate guards (division-by-zero edges).
  - Date-bucketing logic for the report's weekly/monthly sections.
- **Files:** `dashboard-web/src/lib/aiReport.ts` (~700 LOC of statistical
  computation, ~50% now under oracle).
- **Impact:** Math is correct today. Future changes to the bucket boundaries
  or funnel guards could ship undetected by CI.
- **Priority:** Medium. Most-leverage gap closed; remainder is polish.

### Other C-* gaps from v3 audit — CLOSED

- **C-02** — `postgresReaders.ts` newest-row dedup: fixture added in
  commit `c6e590c` (Phase 10).
- **C-03** — `cronLive.ts` past-row backfill date boundary: fixture added in
  commit `e953a2d` (Phase 10).
- **C-04** — `tiktok.ts` `code !== 0` envelope path: test added in commit
  `a7d36f5` (Phase 10).
- **C-05** — `algorithm-parity.test.ts` permanently skipped: file DELETED in
  Phase 11 (commit `74633ee`). No Sheets baseline exists anymore to compare
  against. This is intentional — Apps Script tier was decommissioned, the
  parity gate has no other side to compare to.

---

## Tooling Gaps

### Inngest test glob (RESOLVED — left in for cross-reference)

- **Status:** RESOLVED (Phase 05.6 plan 08, see `vitest.config.ts:30-38`).
- **History:** Pre-resolution, `vitest.config.ts` default glob only targeted
  `src/lib/**/__tests__` and the comment at `cronLive.test.ts:27` warned
  that Inngest tests required an explicit path.
- **Current state:** Config explicitly enumerates BOTH paths:
  `'src/lib/**/__tests__/**/*.test.{ts,tsx}'` AND
  `'src/inngest/**/__tests__/**/*.test.{ts,tsx}'`. A bare
  `npx vitest run` now picks up the full 946-test suite.
- **Lingering risk:** the `cronLive.test.ts:27` header comment is stale and
  still says "must be run with an explicit path" — operator should drop the
  warning when next touching that file. ~1-line doc cleanup.

### No CI workflow

- **Issue:** `.github/workflows/` directory does not exist. There is no
  automated `tsc --noEmit && vitest run` gate on push to main. Every
  invariant we ship depends on the operator (or claude) remembering to run
  the test suite locally before committing.
- **Impact:** Major exposure. The codebase has ~900 tests; without CI, any
  inconvenient one-off could silently break and only surface on the next
  manual run. After Phase 11 deleted the `clasp` CI workflow (the only
  workflow that existed), there is now zero automated gating.
- **Fix approach:** Add `.github/workflows/test.yml` that runs on push to
  main and on PRs: `cd dashboard-web && npm ci && npx tsc --noEmit && npx vitest run`.
  Add a status badge to README.md.
- **Target phase:** Polish pass — high value, low effort. Strongly recommended
  before Phase 6 (security work).

### No cross-fetcher contract test

- **Issue:** The 4 ad-platform fetchers (`meta.ts`, `googleAds.ts`,
  `tiktok.ts`, `shopify.ts`) all return rows with a conceptual
  `{ storeId, date, spend, currency }` shape, but no shared type or
  contract test enforces this. A future change that shifts e.g. tiktok's
  `spend` from CAD to USD without updating the FX wrapper would not fail
  any test — it would just produce silently wrong dashboard numbers.
- **Files:** `dashboard-web/src/lib/fetchers/{meta,googleAds,tiktok,shopify}.ts`.
- **Impact:** Major future-fragility. Each fetcher is well-tested in
  isolation, but the cross-fetcher contract is implicit.
- **Fix approach:** Add a `lib/fetchers/__tests__/fetcherContract.test.ts`
  that imports each fetcher's output type and asserts the common shape +
  currency invariants. Optionally extract a shared `FetcherRow` type.
- **Target phase:** Polish pass.

### No integration test for cron-live × Supabase

- **Issue:** Every cron-live test mocks Supabase. The full pipeline
  cron-live → Supabase upsert → postgresReaders read is exercised piecewise
  but never end-to-end against a real (or even stubbed-real) Supabase
  instance.
- **Files:** `dashboard-web/src/inngest/functions/__tests__/cronLive.test.ts`,
  `dashboard-web/src/lib/__tests__/postgresReaders.test.ts`.
- **Impact:** Schema drift between writer and reader could go undetected.
  Phase 10 C-02 (newest-row dedup) fixture is a step toward this but still
  exercises only one direction.
- **Fix approach:** Spin up a Supabase local instance (or use the existing
  staging project with a test schema) for one integration test per cron
  cycle. Heavy lift; defer unless schema drift bites.
- **Target phase:** Phase 7 (Observability) or later.

---

## Architectural Concerns

### Single-operator + URL-obscurity trust model (ACCEPTED)

- **Issue:** No auth gate on inner dashboard routes. The trust boundary is
  "you have the URL". Internal routes accept any client.
- **Impact:** Inappropriate for any future multi-user scenario. Adequate for
  the current single-operator internal-tool model.
- **Operator stance:** Explicitly accepted (per memory entry
  `project_script_roas_dashboard.md`). Phase 6 (Security) explicitly DROPPED
  rate-limit / If-Match / auth gating — confirmed 2026-05-19.
- **Status:** Accepted constraint. Document in README before any future
  attempt to expose the dashboard publicly. **Do not silently retrofit.**

### Apps Script tier fully removed (Phase 11)

- **Status note:** The dual-tier Sheets-vs-Postgres concern from earlier
  audit rounds is gone. After Phase 11 (commits `9c09696`..`1973d06`):
  - 10 `.gs` files at repo root: deleted
  - `appsscript.json` + `.clasp.json`: deleted
  - `lib/sheets.ts`: deleted (after relocating `isAllowedStateKey` +
    `StoreMetaRow` type elsewhere)
  - `featureFlags.ts::readFrom()`: removed (READ_FROM=postgres has been
    permanent since Phase 05.7.0)
  - `algorithm-parity.test.ts`: deleted (no Sheets baseline left to
    compare against)
- **Implication for future work:** Any document, comment, or memory referring
  to "the Sheets tier", `READ_FROM`, `clasp`, or `runDailyUpdate` is now
  stale. All data-plane work is in `dashboard-web/src/inngest/functions/`
  and `dashboard-web/src/lib/fetchers/`.

---

## Operational Concerns

### Token-failure WhatsApp alerts — SHIPPED, but single-recipient

- **Status:** WhatsApp template approved by Meta on 2026-05-22. Alerts are
  wired and fire on token failures.
- **Constraint:** Alerts go ONLY to `+972524809540`. Hardcoded
  single-recipient by design (operator's personal number) — intentional per
  memory `project_token_failure_alerts_pending.md`.
- **Implication:** If the operator's number changes, the constant must be
  updated in code. No alternate recipient as backup. If that single number
  is unreachable, the alert is lost.
- **Future-claude note:** Do NOT regress to multi-recipient without explicit
  operator request. The single-recipient choice is deliberate.

### Google OAuth refresh token expires ~2026-05-30

- **Issue:** The `roas-tracker-ga` OAuth consent screen is in TESTING mode.
  Refresh tokens issued by TESTING-mode OAuth apps expire after 7 days.
  Current token issued ~2026-05-23 → expires ~2026-05-30.
- **Fix (operator-only — cannot be done by claude):** Operator must publish
  the `roas-tracker-ga` OAuth consent screen to PRODUCTION in Google Cloud
  Console. Once published, refresh tokens become permanent (no 7-day expiry).
- **Impact:** When the token expires, all Google Ads cron-live + cron-daily
  fetches will start failing with auth errors. Dashboard's Google Ads spend
  column for `uzoshop` (the only `STORES_WITH_GOOGLE_ADS` member) will go
  stale. Will surface as Inngest job failures + WhatsApp alerts.
- **Reference:** Memory entry `project_google_oauth_refresh_token_pending`.
- **Target action:** Operator to publish the OAuth screen before 2026-05-30.

### FX failure path — Frankfurter outage masking

- **Background:** Both `cronDaily` and `cronLive` now wrap `getFxRate` (USD→CAD)
  in a `.catch(() => null)` block (Phase 10 CRIT-5 fix + v2 a/WARN-3). On a
  Frankfurter API outage, `fxRate` resolves to `null`, and the per-row
  payload OMITS the `spend_cad` column.
- **Behavior on Supabase upsert:** `ON CONFLICT DO UPDATE` with the column
  omitted means Supabase PRESERVES the prior `spend_cad` value for that row.
- **Visible symptom:** The CAD spend column appears "stuck" at yesterday's
  value (or last-successful-FX-day value) until Frankfurter recovers. There
  is NO error chip in the dashboard, NO WhatsApp alert. Operator sees a
  static number and may not realize FX is down.
- **Files:** `dashboard-web/src/inngest/functions/cronDaily.ts`,
  `dashboard-web/src/inngest/functions/cronLive.ts`,
  `dashboard-web/src/lib/fetchers/fx.ts`.
- **Impact:** Medium. Spend in native USD is still updated correctly. Only
  the CAD conversion lags during outage. ROAS calculations downstream use
  CAD, so they'll lag too.
- **Fix approach:** Surface FX staleness in the dashboard — e.g. a chip on
  the spend column when the row's `fx_rate_used_at` is older than 24h. Not
  blocking until next Frankfurter outage.
- **Target phase:** Phase 7 (Observability) — FX staleness chip.

### WhatsApp EOD timing moved to 00:30 IL

- **Background:** Phase 10 HIGH-13 moved the WhatsApp end-of-day summary
  trigger from 00:10 IL to 00:30 IL. The reason: `cronDaily`'s retry budget
  is ~7.5 minutes (3 retries × 2.5 min); a 00:10 EOD could fire before
  `cronDaily` had finished a retry-laden run, producing an EOD summary based
  on partial data.
- **Status:** SHIPPED. Operator confirmed acceptable.
- **Risk:** None today. Future increase of `cronDaily` runtime past 25min
  would re-introduce overlap. Monitor Inngest job durations if fetcher count
  grows.

### Bayesian shrinkage uses best-of(orders, spend) — needs operator validation

- **Background:** Phase 10 b/HI-02 changed cohort ranking to use the
  best-of-two Bayesian shrinkage:
  `shrinkage = max(orders / (orders + 10), spend / (spend + 500))`
  instead of either alone. Intent: a low-order ad-set with high spend
  shouldn't get extreme shrinkage (or vice versa).
- **Files:** `dashboard-web/src/lib/campaignHealthScore.ts` cohort block.
- **Risk:** Operator should periodically eyeball that cohort rankings don't
  drift unexpectedly compared to pre-Phase-10 behavior. The shrinkage curve
  is now non-monotonic in a sense (best-of-two = max), so an ad-set crossing
  one of the two thresholds can jump in ranking discontinuously.
- **Mitigation:** Phase 10's regression tests pin the math; operator-visible
  drift would surface in the cohort comparison drawer.

---

## Recent Direction Shifts (Operator Corrections)

### GoalTracker is GLOBAL — never scope to filters.store or filters.range

- **Date:** 2026-05-23 (operator correction).
- **Constraint:** `GoalTracker.tsx` MUST ignore `filters.store` AND
  `filters.range`. The monthly goal is a single business-wide target across
  all stores. Filtering it would render an incomplete picture of progress
  toward the actual goal.
- **Reference:** Memory entry `feedback_monthly_goal_is_global`.
- **Future-claude action:** When touching `GoalTracker.tsx` or any goal-related
  hook, verify the global-scope contract is preserved. Do NOT introduce a
  per-store goal without explicit operator request.

### TodayLive is always LIVE — own SWR fetch decoupled from filters.range

- **Date:** 2026-05-23 (operator-reported).
- **Constraint:** `TodayLive.tsx` (or its hook) must fetch its own LIVE data
  for today's date, recomputed on every render. It must NOT respect the
  operator's chosen date range filter. The whole point of TodayLive is to
  show "what's happening right now", not "what happened in the selected
  range".
- **Future-claude action:** When touching TodayLive or any "today's
  performance" surface, verify the date is recomputed every render (not
  memoized at mount) and that no `filters.range` dependency is introduced.

---

## Items Removed from Previous CONCERNS.md (now resolved or obsolete)

The previous CONCERNS.md (2026-05-18) listed concerns that have since been
closed. Documenting here so future-claude doesn't re-raise them:

- **Apps Script 6-min execution limit** → OBSOLETE. Apps Script decommissioned
  in Phase 11.
- **No test suite** → CLOSED. Vitest installed; ~900 tests across `lib/` and
  `inngest/functions/`.
- **COGS rate duplicated** → CLOSED. Now driven by per-store env vars
  (`${STORE_UPPERCASE}_COGS_RATE`); single source per store.
- **Cloud-sync last-write-wins** → OBSOLETE. Single operator + Supabase
  upsert with `updated_at` newest-row wins per Phase 10 C-02 fixture.
- **Reconciliation panel uses campaign-active days only** → Resolved in
  earlier polish work (see commit history in `MetaShopifyReconciliation`).
- **Product ID precision (Sheets scientific notation)** → OBSOLETE. Sheets
  tier removed; Supabase columns are properly typed.
- **CampaignsTable / CampaignDrawer / BillingSettings >1300 LOC** → Status
  unchanged but flagged in Phase 4 of the roadmap (not in audit scope).

---

*Concerns audit: 2026-05-24 — post Phase 10 + 11 + 12, baseline `b846ae7`.*

# Docs Currency & Audience Split Audit

**Auditor:** Track 7 (Opus 4.7 1M ctx) · **Date:** 2026-05-24 · **HEAD:** `4c3f7e9` · **Mode:** read-only.

---

## Summary

The post-Phase-12.5.x dashboard is largely *better* documented than most codebases, but the audience-split discipline is **not enforced** and several primary docs are stale relative to the last week of shipped commits.

Headline findings:

1. **Pre-push docs-gate is ABSENT (P0).** The memory rule "docs currency on par with tsc/vitest" has zero enforcement: no `.husky/`, no GitHub Actions, no `lint-staged`, no pre-push hook of any kind. Root `package.json` even still ships `clasp` + `deploy:gs` from the long-decommissioned Apps Script tier — i.e., the only automation that ever existed at the repo root is dead.
2. **Three major shipped features have no User-Manual entry (P0).** The multi-mapping cohort comparison panel (steps 1–3 of 5 per project memory), cannibalization detection, and the cohort-aware Health Score adjustment are all live in code (`CohortComparisonPanel.tsx`, `cannibalizationDetection.ts`, `campaignHealthScore.ts`) but the User Manual never names them. The word *cannibalization* / *קניבל* never appears; *cohort* appears only once in a passing reference at line 779.
3. **The AI report's RTL + executive-briefing prompt directives shipped today (commit `4c3f7e9`) are documented in NEITHER doc (P1).** User Manual §31.2 still summarizes the *old* prompt; ARCHITECTURE.md §10 doesn't mention the RTL contract block at all.
4. **PROPS-MAP is 17 env-vars short of code reality (P1).** The doc opens with "Operator checklist gating Phase 05.7 cut-over" — Phase 11 was 3 days ago; this header is wrong-context. More importantly, of the 23 unique `process.env.X` references in `dashboard-web/src/`, 17 are not in the table.
5. **STATE.md + ROADMAP.md make zero mention of Phase 12.5 / 12.5.x (P1).** The most recent narrative entry is "Phase 12.3 closed" — but 11 atomic Phase-12.5.x commits have shipped since (off-chip fixes, PnL %, URL state, token-failure wiring, AI-report RTL).
6. **.planning/codebase/TESTING.md is heavily stale (P1).** Claims "87 test files / 946 tests / 4.6s runtime." Reality: **113 / 1054 / 5.48s**.
7. **HANDOFF-2026-05-22.md remains in the repo as if pending (P2).** Both work items it lists (Phase 05.3 + 05.4) were explicitly DEFERRED by the operator on 2026-05-24 (per ROADMAP.md §Deferred). The handoff should be marked obsolete or moved into a history folder.

No P0 *audience-split violations* found — UX changes do consistently land in the User Manual and architecture changes in `docs/ARCHITECTURE.md` when they land at all. The problem is omission, not mis-routing.

---

## P0 — missing critical feature docs + missing pre-push gate

### P0-DOCS-01 — No pre-push enforcement for docs currency
- **Files:** repo root + `dashboard-web/`.
- **Evidence:** `ls .husky` → not present. `find .github -type f` → empty. `package.json` (`scripts`) has only `deploy:gs` (vestigial clasp/Apps Script). `dashboard-web/package.json` (`scripts`) has only `dev / build / start / lint / test / test:watch / test:coverage` — no `predeploy` / `prepush` / `verify`.
- **Reality:** Project memory rule: *"Keep docs current — split by audience. Two separate pre-push gates, on par with tsc/vitest."* — no executable enforces this. A future commit that mutates a UX surface without touching the User Manual will pass CI silently.
- **Fix:** Add a `pre-push` husky hook (or a lightweight `predeploy` npm script) that fails when (a) any `dashboard-web/src/components/**` file changed *and* `docs/ROAS-Dashboard-User-Manual.md` did not, OR (b) any `dashboard-web/src/inngest/**` / `dashboard-web/src/lib/postgresReaders.ts` / `dashboard-web/src/lib/fetchers/**` changed and `docs/ARCHITECTURE.md` did not. Or: a docs-staleness review checklist enforced via GitHub Action. The exact mechanism is operator-decision; the *absence* of any mechanism is the P0.

### P0-DOCS-02 — Multi-mapping cohort panel undocumented in User Manual
- **Files:** `dashboard-web/src/components/CohortComparisonPanel.tsx` (rendered at `CampaignDrawer.tsx:1281`); `dashboard-web/src/lib/multiMappingCohort.ts`.
- **Claim:** Per project memory "Multi-mapping intelligence — Steps 1-3 of 5 shipped (cohort panel, cannibalization detection, cohort-aware Health Score)."
- **Reality:** The User Manual mentions *cohort* exactly once (line 779, "פאנל cohort בדרוארה") — and that's a passing reference in a different topic (allocateProductRevenue). There is no §describing what the panel shows, when it appears, what 🥇/🥈/🥉 mean, what intra-platform vs cross-platform sections represent, or how to use it. CampaignDrawer (§8 of the manual) lists Attribution / Reconciliation / CPM / Mapped Products / AdSetTable but NOT cohort comparison.
- **Fix:** Add §8.4-bis "פאנל השוואת קוהורט" with: when it appears (mapped products shared with ≥1 other campaign), the 🥇/🥈/🥉 ranking semantics, what to do about a "cohort saturation" verdict, and the link to the cohort-aware Health Score adjustment.

### P0-DOCS-03 — Cannibalization detection undocumented in User Manual
- **Files:** `dashboard-web/src/lib/cannibalizationDetection.ts`; consumed in `CohortComparisonPanel.tsx`.
- **Claim:** Per project memory "Steps 1-3 of 5 shipped … cannibalization detection."
- **Reality:** The word *cannibalization* (or any Hebrew translation: *קניבל*, *גזילה*, *הברחת תקציב*) never appears in the User Manual. The only matched substring was "דעיכה" (line 615) — unrelated semantic.
- **Fix:** Document the cannibalization verdict UI element + the "scale X **or** Y, not both" guidance the AI report already cites (User Manual §7.9c does say "scale X או Y, לא שניהם" but never explains the underlying detection that triggers it).

### P0-DOCS-04 — Cohort-aware Health Score adjustment undocumented in User Manual
- **Files:** `dashboard-web/src/lib/campaignHealthScore.ts:57-68, 477-499` (`cohortAdjustment` component, ±3 to +3 range).
- **Reality:** User Manual §7.16 enumerates the 4 Health Score components (rentability / volume / momentum / attribution clarity) + operator adjustments (+15 / −30), but does NOT mention the cohort-aware adjustment. The score in production is `Σ components + operatorAdj + cohortAdjustment`, but the manual implies the formula ends at `operatorAdj`.
- **Fix:** Append a short paragraph to §7.16 describing the cohort adjustment (when it applies; range ±3; sign rules: leader → +; lagging-in-saturated → −).

---

## P1 — drift in primary docs

### P1-DOCS-01 — AI report RTL + executive-briefing prompt directives undocumented (commit `4c3f7e9`)
- **Files:** `dashboard-web/src/lib/aiReport.ts:2207-2255` (Phase 12.5.x block — RTL contract, Hebrew formatting rules, McKinsey/BCG executive-briefing tone, anti-platitudes).
- **User Manual §31.2:** lists prompt directives ("scale = A/B + …", "pause = D/F …", "anti-platitudes") but never mentions the RTL contract, the executive-briefing format requirement, or the "thesis-first" sentence style now mandated.
- **ARCHITECTURE.md §10:** describes report content + persona but never the RTL formatting contract that today's commit introduced.
- **Fix:** Add a sub-section to User Manual §31.2 ("פורמט תשובה — RTL + רמת דוח מנהלים") and a bullet to ARCHITECTURE.md §10 "Prompt formatting contract (Phase 12.5.x)" referencing `aiReport.ts:2207-2255`.

### P1-DOCS-02 — `docs/ARCHITECTURE.md` claims `sheets.ts` + `featureFlags.ts` still exist; they were deleted in Phase 11
- **File:** `docs/ARCHITECTURE.md:550-552` ("dashboard-web/src/lib/sheets.ts עוד קיים … isAllowedStateKey נשאר … featureFlags.ts נשאר") and `:813-814` ("sheets.ts — legacy (kept for isAllowedStateKey); featureFlags.ts — legacy").
- **Reality:** `ls dashboard-web/src/lib/sheets.ts` → no such file. `ls dashboard-web/src/lib/featureFlags.ts` → no such file. Phase 11 deleted both; `isAllowedStateKey` was moved to `dashboard-web/src/lib/dashboardStateKeys.ts` (per STRUCTURE.md:117).
- **Fix:** Edit ARCHITECTURE.md §13.3 + §22 to remove the "still exist" claim; point `isAllowedStateKey` reference to `dashboardStateKeys.ts`.

### P1-DOCS-03 — `docs/ARCHITECTURE.md` data-flow diagram still mentions Apps Script triggers as transitional
- **File:** `docs/ARCHITECTURE.md:57` ("Apps Script triggers יורדים ידנית במהלך 28.4 cutover.")
- **Reality:** Phase 11 (2026-05-24) hard-removed all `.gs` + `appsscript.json` + `.clasp.json`. No Apps Script triggers exist to "be taken down manually."
- **Fix:** Strike that line.

### P1-DOCS-04 — `docs/ARCHITECTURE.md` undercounts Inngest functions (says 11; actual 12)
- **File:** `docs/ARCHITECTURE.md:89` ("4.1 8 פונקציות הליבה") + `:102` ("4.2 3 פונקציות WhatsApp") + `:686` (smoke test: "expect 8 (+3 whatsapp)").
- **Reality:** Run `grep "inngest.createFunction" dashboard-web/src/inngest/functions/*.ts` → 12 functions: 3 cronDaily + 3 cronLive + 1 eventSyncNow + 1 eventBackfill + 3 whatsapp cron + 1 `eventWhatsappSendNow` (operator "send WhatsApp now" button, registered at `app/api/inngest/route.ts:120`).
- **Fix:** ARCHITECTURE.md §4.2 should list the 4th WhatsApp function (`event-whatsapp-send-now`); smoke test in §19 should expect 12. Same fix applies to `.planning/codebase/STRUCTURE.md:71, 109, 138, 252, 285`.

### P1-DOCS-05 — STATE.md + ROADMAP.md have zero entry for Phase 12.5 / 12.5.x
- **Files:** `.planning/STATE.md`, `.planning/ROADMAP.md`.
- **Reality:** Latest narrative bullet in STATE.md is "Phase 12.3 closed." Since then, 11 atomic 12.5.x commits have shipped: `c1be302`, `4e02064`, `eab5a06`, `0ed634a`, `5d431a5`, `d82e17e`, `2c15dbb`, `6159add`, `d1fa534`, `41bbaa8`, `f33b8a4`, `d0a0743`, `da997b2`, `4f36f7a`, `6fd0d68`, `b974038`, `0136732`, `4c3f7e9`. None are mentioned. ROADMAP.md still classifies "Phase 12 audit baseline COMPLETE: 27/27 bugs (8 P0 + 11 P1 + 8 P2)" as the latest entry — Phase 12.4 (Sheets-tier dead-code purge, commit `5a9082e`) and Phase 12.5 / 12.5.x don't even appear.
- **Fix:** Add a Phase 12.5 entry to ROADMAP.md (and a milestone-evolution bullet to STATE.md) summarizing: off-chip robustness, URL state persistence, PnL % of revenue, token-failure cron wiring, AI report RTL.

### P1-DOCS-06 — `.planning/codebase/TESTING.md` claims 87 files / 946 tests; reality is 113 / 1054
- **File:** `.planning/codebase/TESTING.md:15-19` (table headed "Live counts at HEAD (verified by `cd dashboard-web && npx vitest run`)").
- **Reality:** `find dashboard-web/src -name '*.test.ts' -o -name '*.test.tsx' | wc -l` → 113. `npx vitest run` → "Test Files 112 passed (112) · Tests 1054 passed (1054) · Duration 5.48s." The "1054" likely reflects 12.5.x regression tests added on top of the audit baseline's 1040.
- **Fix:** Re-run the table generator; update.

### P1-DOCS-07 — `.planning/codebase/STACK.md` says "13 migrations" / "13 forward-only files"; actual is 11
- **File:** `.planning/codebase/STACK.md:14` ("SQL — Supabase migrations only (`supabase/migrations/*.sql`, 13 forward-only files)") + `:65` ("13 migrations").
- **Reality:** `ls supabase/migrations/*.sql | wc -l` → 11.
- **Fix:** Update to 11. (`.planning/codebase/STRUCTURE.md:175, 186, 236` correctly say 11 — STACK.md is the outlier.)

### P1-DOCS-08 — `.planning/codebase/STRUCTURE.md` lib file count off by 13
- **File:** `.planning/codebase/STRUCTURE.md:231` ("`dashboard-web/src/lib/` | 54 (non-test)").
- **Reality:** `find dashboard-web/src/lib -name '*.ts' -not -path '*__tests__*' | wc -l` → 67 (50 top-level + 4 hooks + 9 notifications + 4 fetchers w/o shopifyAuth duplicate? let me recount). Actual breakdown: 50 lib root + 7 fetchers + 4 hooks + 5 notifications + 1 supabaseAdmin = 67 non-test files. Doc claims 54 (likely pre-Phase-12.x additions).
- **Fix:** Re-run the count generator.

### P1-DOCS-09 — `.planning/codebase/INTEGRATIONS.md` undercounts fetcher files
- **File:** `.planning/codebase/INTEGRATIONS.md:7` ("All third-party calls go through **5 typed fetcher modules**").
- **Reality:** `ls dashboard-web/src/lib/fetchers/*.ts` (non-test) → 7 files: `fx.ts`, `googleAds.ts`, `manualOverrides.ts`, `meta.ts`, `shopify.ts`, `shopifyAuth.ts`, `tiktok.ts`.
- **Fix:** Update INTEGRATIONS.md to "7 typed fetcher modules" and add the `shopifyAuth.ts` + `manualOverrides.ts` rows to the per-API table (currently only the 6 external APIs are covered).

### P1-DOCS-10 — User Manual §4.3 (GoalTracker) doesn't state the goal is GLOBAL
- **File:** `docs/ROAS-Dashboard-User-Manual.md:344-358`.
- **Project memory:** "Monthly goal panel is global — GoalTracker must ignore filters.store + filters.range; one business-wide target across all stores."
- **Code:** `dashboard-web/src/components/GoalTracker.tsx:28-41` explicitly documents "intentionally GLOBAL — one business-wide target … neither the store filter nor the date range affecting it."
- **Reality in User Manual §4.3:** Describes "יעד החודש" + projection but never says the goal is business-wide and ignores both the store filter and the date range. An operator reading the manual would expect the goal to follow the global filter — which is exactly the regression that the 2026-05-23 audit (CR-04) introduced and the operator had to reverse.
- **Fix:** Add 1 sentence to §4.3: "ה-GoalTracker הוא **גלובלי** — תמיד מציג סך כל החנויות לכל החודש הנוכחי, בלי קשר לפילטר חנות או טווח התאריכים שנבחר."

### P1-DOCS-11 — `docs/PROPS-MAP.md` is stale-context: header still says "Phase 05.7 cut-over"
- **File:** `docs/PROPS-MAP.md:3-6`.
- **Reality:** Phase 05.7 finished long ago; Phase 11 hard-decommissioned the Apps Script tier 3 days ago; we're at Phase 12.5.x. The opening line "Operator checklist gating Phase 05.7 cut-over. Each row is one Apps Script PropertiesService key from `.env`" is doubly stale — there's no Apps Script tier and the cut-over is done.
- **Fix:** Replace opening note with current-state framing: "43-row env-var checklist post-Phase-11 single-tier. Vercel env vars + Supabase notification_config rows."

---

## P2 — small inaccuracies, stale TOC entries

### P2-DOCS-01 — User Manual footer date is `2026-05-22`; manual content includes Phase 12.5.x (2026-05-24) updates
- **File:** `docs/ROAS-Dashboard-User-Manual.md:2221` ("גרסה: 2.0 · תאריך עדכון: 2026-05-22").
- **Reality:** §5.4-bis, §5.4a, §30.4a are all dated 2026-05-24 inline.
- **Fix:** Update footer to 2026-05-24 (or to "current" without a date and let `git log` be the source of truth).

### P2-DOCS-02 — `SYSTEM_OVERVIEW.md` is *kept as historical* but is 985 lines of Apps Script narrative, with only a 14-line header acknowledging Phase 11
- **File:** `SYSTEM_OVERVIEW.md:1-15` (the only correctly-dated note) vs. lines 16-985 (the legacy Apps Script architecture).
- **Reality:** Operator-facing docs README.md links to SYSTEM_OVERVIEW.md as the "system overview." Operators landing on it will see a 970-line description of a tier that doesn't exist. The header tells them so, but the value-add is questionable.
- **Fix:** Either truncate to a 1-page summary + link to ARCHITECTURE.md, or move to `.planning/notes/SYSTEM_OVERVIEW-pre-phase-11.md` as a historical archive.

### P2-DOCS-03 — README.md `setup` step 3 references `supabase db push` without noting `--linked --include-all` requirement
- **File:** `README.md:87`. ARCHITECTURE.md correctly says `supabase db push --linked --include-all` (line 79) — README abbreviates and may mislead.
- **Fix:** Sync flags.

### P2-DOCS-04 — ARCHITECTURE.md §19 smoke-test expects "8 (+3 whatsapp)" Inngest functions
- **File:** `docs/ARCHITECTURE.md:686`. Same root cause as P1-DOCS-04 (12 not 11).
- **Fix:** Bump expectation to 12.

### P2-DOCS-05 — User Manual TOC (line 63-97) does not list §27 / §29 / §30 / §31 — the operator-console + WhatsApp + AI-report sections
- **File:** `docs/ROAS-Dashboard-User-Manual.md:63-97`.
- **Reality:** Body has §27 (ניהול / Operator Console), §29 (Reset Data), §30 (WhatsApp), §31 (AI report) — none are in the TOC at the top.
- **Fix:** Extend TOC.

### P2-DOCS-06 — Quick-Start footer date stale (2026-05-22) vs. content
- **File:** `docs/ROAS-Dashboard-Quick-Start.md:109`.
- **Note:** Content is broadly current; just the date. Same low-severity as P2-DOCS-01.

### P2-DOCS-07 — Root `package.json` still has `deploy:gs` script + `@google/clasp` devDep
- **File:** `package.json:4-9`.
- **Reality:** Phase 11 decommissioned Apps Script. The script targets nothing; the dep is unused (no `.gs` files exist).
- **Fix:** Remove both. (Not strictly a docs issue but it is *code-as-docs* — the repo's package.json advertises a capability that doesn't exist.)

---

## User Manual parity table

| Feature (from `Dashboard.tsx` + recent commits) | Documented? | Accurate post-12.5.x? | Manual ref |
|---|---|---|---|
| 6 tabs (Home / P&L / Analysis / Campaigns / Products / Detail) | ✅ | ✅ | §2.2 |
| TodayLive | ✅ | ✅ | §4.1 |
| HeroOverview + ROAS chart + annotations | ✅ | ✅ | §4.2 |
| GoalTracker | ✅ | ⚠️ Missing GLOBAL note | §4.3 (see P1-DOCS-10) |
| InsightsBoard | ✅ | ✅ | §4.4 |
| AnnotationsPanel | ✅ | ✅ | §4.5 |
| KpiCards + PerStoreCards | ✅ | ✅ | §4.6–4.7 |
| WhatsWorking | ❌ | N/A | — (component exists in code but not in manual) |
| PnL Hero strip + Waterfall | ✅ | ✅ | §5.1–5.5 |
| PnL "% of revenue" cost type (12.5.x) | ✅ | ✅ | §5.4-bis |
| PnL fixed-cost category breakdown (12.5) | ✅ | ✅ | §5.4a |
| PnL breakdown realtime on billing change (12.5.x) | ⚠️ Partial | Visible in §5.4a but the "realtime" behaviour is implicit, not named | §5.4a |
| BillingSettings modal | ✅ | ✅ | §5.3 |
| CSV import | ✅ | ✅ | §5.4 |
| AnalysisTab (RoasChart + MonthlyTables) | ✅ | ✅ | §6.1–6.4 |
| CampaignsTable | ✅ | ✅ | §7.1–7.17 |
| Attribution Gap Panel | ✅ | ✅ | §7.2 |
| CPM-vs-ROAS chart | ✅ | ✅ | §7.4 |
| 4-level trust chip | ✅ (notes its retirement) | ✅ | §7.8 |
| Off-chip "כבוי כרגע" | ✅ | ✅ (12.5.x fix is documented) | §7.9 + §7.9 inline note |
| Off-chip uses `updated_at` for freshest status (12.5.x, commit `4f36f7a`) | ❌ | The §7.9 note says "the chip reflects current status" but doesn't name the mechanism (updated_at-DESC dedup) | — (User Manual rightly hides the mechanism, but the symmetry "works for pause + resume" is also missing — operator can't predict behaviour) |
| Multi-mapping cohort panel (steps 1-3 of 5) | ❌ | — | P0-DOCS-02 |
| Cannibalization detection | ❌ | — | P0-DOCS-03 |
| Cohort-aware Health Score adjustment | ❌ | — | P0-DOCS-04 |
| "לא ממופה" chip | ✅ | ✅ | §7.9b |
| Multi-platform product mapping (same product mapped to N campaigns) | ✅ | ✅ (great writeup) | §7.9c |
| CBO / ABO | ✅ | ✅ | §7.10 |
| Show-more / sort / column reorder | ✅ | ✅ | §7.11–7.12, §7.17 |
| Campaign Health Score (4 components + grade) | ✅ | ⚠️ Missing cohort adjustment | §7.16 (see P0-DOCS-04) |
| CampaignDrawer (Attribution / Reconciliation / Mapping / AdSetTable) | ✅ | ✅ | §8 |
| AdsDrawer | ✅ | ✅ | §9 |
| ProductsTable + ProductCentricView | ✅ (Products tab) | ⚠️ `ProductCentricView` is a new component in `Dashboard.tsx`; manual §10 doesn't distinguish the two views | §10 |
| DetailTable | ✅ | ✅ | §11 |
| Reconciliation panel (4 series) | ✅ | ✅ | §12 |
| Attribution overview | ✅ | ✅ | §13 |
| Backfill via /operator | ✅ | ✅ | §16, §27.2.3 |
| Refund-day attribution | ✅ | ✅ | §16.8–16.11 |
| Operator console (Sync / Jobs / Backfill / manual-overrides / WhatsApp / Reset) | ✅ | ✅ | §27 |
| Reset Data | ✅ | ✅ | §29 |
| WhatsApp daily summary | ✅ | ✅ | §30 |
| Token-failure alerts (12.5.x, recipient + throttle) | ✅ | ✅ excellent writeup | §30.4a |
| AI report — content + persona | ✅ | ✅ | §31.1 |
| AI report — RTL contract + executive-briefing tone (12.5.x, commit `4c3f7e9`) | ❌ | — | P1-DOCS-01 |
| AI report — creative-level drilldown | ✅ | ✅ | §31.1 |
| URL state — drill + mode + sort persistence (12.5.x) | ✅ | ✅ | §2.3 inline note |
| SWR cache hardening (12.5.x, commit `b974038`) | N/A (internal) | — | Architecture concern only — User Manual doesn't need to surface this |
| FreshnessChip / TabFreshnessHeader | ❌ | — | Component exists, never named in manual |
| CloudSync mechanism | ✅ | ✅ | §2.1 + glossary |

---

## ARCHITECTURE.md parity table

| Component / decision | Documented? | Accurate? | Ref |
|---|---|---|---|
| Apps Script tier removal (Phase 11) | ⚠️ Implicit | Diagram still hints at it (§2 line 57); §13.3 + §22 still claim `sheets.ts` / `featureFlags.ts` exist | P1-DOCS-02, P1-DOCS-03 |
| Inngest as cron orchestrator | ✅ | ✅ | §4 |
| 11 Inngest functions claim | ✅ | ❌ Should be 12 (missing `eventWhatsappSendNow`) | P1-DOCS-04 |
| 7 fetcher modules | ✅ enumerated | ⚠️ INTEGRATIONS.md claims 5 | P1-DOCS-09 |
| 8 Postgres readers + 1 writer | ✅ | ✅ correctly referenced as `postgresReaders.ts` | §13 |
| 10 Postgres tables | ✅ | ⚠️ STRUCTURE.md says "11+ tables" and includes `token_failures` (added 2026-05-23); ARCHITECTURE.md §3 still says "10 tables" | minor — same root cause as undercounted migrations |
| Supabase Postgres as data store | ✅ | ✅ | §3 |
| RLS-off posture | ✅ | ✅ | §3 |
| Token-failure pathway (DB + WhatsApp throttle) | ✅ | ✅ §9.5 marked "fully wired 2026-05-24" | §9.5 |
| 12.5.x off-chip robustness (UPDATE without lookback, current-status fallback) | ✅ | ✅ | §6.3a, §6.3b |
| 12.5.x URL state | ✅ | ✅ | §6.3c |
| 12.5.x PnL %-of-revenue | ✅ | ✅ | §6.4 |
| 12.5.x AI-report RTL + exec-briefing prompt (commit `4c3f7e9`) | ❌ | — | P1-DOCS-01 |
| 12.5.x off-chip uses `updated_at` to pick freshest status (commit `4f36f7a`) | ✅ | ✅ via §6.3b + `postgresReaders.ts:739-768` docstring | §6.3b |
| 12.5.x SWR cache hardening (commit `b974038`) | ❌ | — | Add a bullet to §16 (Cloud Sync) or §13 (Read paths) describing the SWR cache key strategy + the staleness fix |
| 12.5.x P&L breakdown realtime (commit `6fd0d68`) | ⚠️ Partial | §6.4 covers the % addition, doesn't mention the `roas-billing-changed` event → realtime re-render | Mention the event-driven invalidation |
| Refund handling | ✅ | ✅ | §14 |
| Reset Data | ✅ | ✅ | §12 |
| Operator console routes | ✅ | ✅ | §11 |

---

## PROPS-MAP diff (env vars in code missing from doc)

`grep -rEho 'process\.env\.[A-Z0-9_]+' dashboard-web/src/ | sort -u` returned 23 unique vars. Cross-referenced against `docs/PROPS-MAP.md` (44 named rows). Mismatches:

| Env var in code | In PROPS-MAP? | Note |
|---|---|---|
| `GOOGLEADS_CLIENT_ID` | ❌ Missing | PROPS-MAP row 17 has `googleads.clientId` (Apps Script key) but no Vercel env name match. The Apps Script naming convention `googleads.X` is dot-notation; the Vercel/code convention is UPPERSNAKE — PROPS-MAP only lists the Apps Script names. Needs a clearly-flagged "Vercel env var name" column. |
| `GOOGLEADS_CLIENT_SECRET` | ❌ Missing (same reason) | |
| `GOOGLEADS_DEVELOPER_TOKEN` | ❌ Missing (same reason) | |
| `GOOGLEADS_LOGIN_CUSTOMER_ID` | ❌ Missing (same reason) | |
| `GOOGLEADS_REFRESH_TOKEN` | ❌ Missing (same reason) | |
| `INNGEST_SIGNING_KEY` | ❌ Missing | Used in `app/api/inngest/route.ts:124` (signature verify). Critical — must be in the operator's checklist. |
| `META_GLOBAL_TOKEN` | ❌ Missing | Used in `lib/fetchers/meta.ts:236-238` (per-store fallback). |
| `NODE_ENV` | ❌ Missing | (Set by Vercel automatically — could be intentionally excluded; PROPS-MAP doesn't say.) |
| `NOTIFICATION_RECIPIENT_ALLOWLIST` | ❌ Missing | Used in `lib/notifications/`. Critical — controls who gets token-failure alerts. |
| `SUPABASE_ANON_KEY` | ✅ Row 42 (`supabase.anon.key`) | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Row 43 | |
| `SUPABASE_URL` | ✅ Row 41 | |
| `USMILE360_COGS_RATE` | ❌ Missing | COGS rates per-store — not in PROPS-MAP at all. |
| `UZOSHOP_COGS_RATE` | ❌ Missing | Same — operator runbook `COGS_SETUP.md` mentions them but PROPS-MAP doesn't list them. |
| `ZOLPLUS_COGS_RATE` | ❌ Missing | |
| `UZOSHOP_GOOGLEADS_CUSTOMER_ID` | ✅ Row 28 (as `uzoshop.googleads.customerId`) | |
| `UZOSHOP_GOOGLEADS_REFRESH_TOKEN` | ❌ Missing | Per-store Google Ads refresh-token override; in code at `lib/fetchers/googleAds.ts`. |
| `UZOSHOP_SHOPIFY_DOMAIN` | ✅ Row 22 | |
| `UZOSHOP_SHOPIFY_TOKEN` | ✅ Row 25 | |
| `UZOSHOP_TX_FEES_RATE` | ❌ Missing | Per-store transaction-fees rate override (`lib/costs.ts`). |
| `ZOLPLUS_TX_FEES_RATE` | ❌ Missing | |
| `WHATSAPP_ACCESS_TOKEN` | ❌ Missing (PROPS-MAP only has `metacloud.accessToken` Apps Script name) | Vercel-side name is `WHATSAPP_ACCESS_TOKEN` per ARCHITECTURE.md §9.2 — PROPS-MAP and ARCHITECTURE.md disagree on the name. |
| `WHATSAPP_PHONE_NUMBER_ID` | ❌ Missing (same — listed only as `metacloud.phoneNumberId`) | |

**Action:** PROPS-MAP needs a Vercel-env-name column populated for every row, and 17 missing vars added (or noted as excluded with reason). The Apps Script `someKey.subKey` naming is no longer authoritative.

Note: TikTok env vars (`UZOSHOP_TIKTOK_ACCESS_TOKEN`, `UZOSHOP_TIKTOK_ADVERTISER_ID`) are used in `lib/fetchers/tiktok.ts` but didn't appear in the grep because TikTok was added later via dynamic-string construction (`${storeUpper}_TIKTOK_ACCESS_TOKEN` template-literal). They are in ARCHITECTURE.md §5.4 but not in PROPS-MAP either.

---

## Stale-claims list (Apps Script / Sheets references)

These are claims in current docs that reference the removed Apps Script / Sheets tier. None of them are *wrong* in spirit (they correctly note Phase 11 removed the tier), but they leave the reader unsure of current state:

| File:line | Claim | Reality | Fix |
|---|---|---|---|
| `package.json:4-9` | `"deploy:gs": "clasp push --force"` + `@google/clasp` devDep | Apps Script removed in Phase 11 | Remove both |
| `docs/ARCHITECTURE.md:57` | "Apps Script triggers יורדים ידנית במהלך 28.4 cutover" | Phase 11 removed all triggers | Strike |
| `docs/ARCHITECTURE.md:550-552, 813-814` | `sheets.ts` + `featureFlags.ts` "still exist as legacy" | Files deleted in Phase 11 | Update |
| `docs/ARCHITECTURE.md:733` | "Phase 04.x — Sheets-only pipeline" (historical) | Correct historically — keep as-is | OK |
| `docs/ARCHITECTURE.md:763` | "`SPREADSHEET_ID` — legacy — לא בשימוש מאז 05.7" | Still listed as a Vercel env var | Either remove env var from Vercel and strike from doc, or note "kept for archival access only" |
| `docs/ARCHITECTURE.md:764` | `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` "legacy" | Same | Same |
| `docs/ARCHITECTURE.md:772` | `READ_FROM` "legacy — לא נקרא מאז 05.7" | Phase 11 deleted `featureFlags.ts` — `READ_FROM` is read by nothing | Strike |
| `docs/PROPS-MAP.md:3-6` | "Operator checklist gating Phase 05.7 cut-over … Each row is one Apps Script PropertiesService key" | Phase 11 done; framing is 2 phases out of date | Re-write header |
| `SYSTEM_OVERVIEW.md:74-986` | 900+ lines of "Google Apps Script V8" architecture description | Header (lines 1-15) acknowledges Phase 11 removed it; body is left intact as "historical" | Either truncate to a 1-page summary or move to `.planning/notes/` |
| `README.md:106` | "עד Phase 11 (2026-05-24) המערכת רצה ב-2 שכבות … SYSTEM_OVERVIEW.md מכיל note היסטורי" | Correct — links to the historical doc | OK |
| `.planning/codebase/CONVENTIONS.md:11, 17, 59` | Notes Apps Script decommission + trailing-underscore convention "carried over" | Correctly states decommission; convention note is fine | OK |
| `.planning/codebase/CONCERNS.md:228-239` | "Apps Script tier fully removed (Phase 11)" | Correct closure | OK |
| `.planning/ROADMAP.md:24, 30, 41` | Notes `Phase 3: CI/CD for Apps Script` "subsequently DECOMMISSIONED" | Correct historical entry | OK |

**Key remaining stale items: `package.json` root + `docs/ARCHITECTURE.md` `lib/sheets.ts` claims + `PROPS-MAP.md` header.**

---

## Pre-push docs gate status

**Status: ABSENT.**

- No `.husky/` directory (`ls .husky` → not present)
- No `.github/workflows/` directory
- No `lint-staged` config in any `package.json`
- No `prepush` / `predeploy` / `verify-docs` script in `package.json` (root or `dashboard-web/`)
- Git's default `pre-push.sample` is present in `.git/hooks/` but not installed
- No `pre-commit` framework in repo

The memory rule "Two separate pre-push gates, on par with tsc/vitest" has zero enforcement. Marked **P0-DOCS-01** above.

Quick win: even a 20-line shell script invoked from a husky `pre-push` hook would close the gate. Example: fail if `git diff --name-only origin/main...HEAD | grep -E '(components|inngest/functions|lib/fetchers|lib/postgresReaders)'` is non-empty AND `git diff --name-only origin/main...HEAD | grep -E '(ROAS-Dashboard-User-Manual|ARCHITECTURE)\.md'` is empty.

---

## `.planning/codebase/*` drift list

| File | Drift | Impact |
|---|---|---|
| `ARCHITECTURE.md:20, 109, 138, 252, 285` | "11 SCHEDULED + EVENT FUNCTIONS" — actual 12 (missing `eventWhatsappSendNow`) | P1 |
| `STRUCTURE.md:71-73, 231-236` | "11 Inngest functions" + "144 specs" + "8 Inngest tests" + "54 lib (non-test)" — all off; actual 12 / 89 / 13 / 67 | P1 |
| `STACK.md:14, 65` | "13 forward-only files" / "13 migrations" — actual 11 | P1 |
| `TESTING.md:11-20` | "87 test files / 946 tests / 4.6s" — actual 113 / 1054 / 5.48s | P1 (already flagged) |
| `INTEGRATIONS.md:7` | "5 typed fetcher modules" — actual 7 | P1 |
| `CONCERNS.md` | Has good Phase 11 closure narrative | OK |
| `CONVENTIONS.md` | Correctly acknowledges Apps Script removal | OK |

These docs have a stamped "Analysis Date: 2026-05-24" — so they were regenerated today, but the counts they assert haven't been re-verified since the Phase 12.4 / 12.5 churn added ~25 new test files. They were generated *before* today's commits landed.

---

## HANDOFF-2026-05-22.md status (done vs pending)

`HANDOFF-2026-05-22.md` was created 2026-05-22 with 2 main work items + 3 ancillary asks. As of 2026-05-24:

| Item | Status now | Evidence |
|---|---|---|
| **§A. Phase 05.4 — Unmapped Active Campaigns Indicator** | ❌ DEFERRED | ROADMAP.md line 40: `~~**Phase 05.4**~~ — DEFERRED (was FROZEN pending 05.2.3.0, never resumed).` |
| **§B. Phase 05.3 — In-dashboard searchable user manual** | ❌ DEFERRED | Not in ROADMAP.md `[x]` list; not in any merged commit; ROADMAP §"Deferred / Out of Scope" doesn't explicitly include it but ROADMAP marks "Phase 2, 4, 5, 5.4, 6, 7, 8" as deferred — 05.3 should be added. The research artifacts referenced still exist on disk (`.planning/phases/05.3-...`) but the plan was never written. |
| **§C.1 Phase B of column customization (drag-reorder + per-column color)** | ❌ Not shipped | No commits for either. |
| **§C.2 Rename `metaClaim` → `platformClaim`** | ❌ Not shipped | `git log --grep='metaClaim\|platformClaim'` → no rename commit. |
| **§C.3 Open questions for 05.3 + 05.4** | ❌ Moot (both phases deferred) | — |
| **§D Confirmed working in production (TikTok creds, Supabase migration)** | ✅ Still true | — |

**Action:** HANDOFF-2026-05-22.md should be either marked OBSOLETE at the top or moved into `.planning/notes/archived-handoffs/`. The operator's 2026-05-24 decision to defer Phases 2, 4, 5, 5.4, 6, 7, 8 implicitly invalidates §A and §B of this handoff — but a reader entering the repo cold would not know that.

---

## Notes for other tracks

- **Track 3 (Pipeline):** The Inngest function count (12, not 11) matters for any per-function reliability or cost-budget analysis. The 12th is `eventWhatsappSendNow` (operator-triggered, no schedule).
- **Track 4 (Architecture):** `docs/ARCHITECTURE.md` is the operator-facing pipeline doc and has 3 P1-level stale claims (sheets.ts existence, Apps Script triggers, function count) — please cross-check against your architectural findings.
- **Track 5 (Code maturity):** Test-suite counts are 113 / 1054 (not the 946 + 94 = 1040 the audit narrative tracks against). The +14 delta is from Phase 12.5 / 12.5.x regression tests.
- **Track 6 (Frontend):** The `CohortComparisonPanel`, `CannibalizationDetection`-driven verdicts, `FreshnessChip`, `TabFreshnessHeader`, and `ProductCentricView` components all exist in code but have ZERO User Manual presence — if your audit surfaces UX issues there, the operator won't have any reference doc to read against.
- **Track 8 (Performance):** The SWR cache hardening (commit `b974038`) is in code but undocumented in ARCHITECTURE.md §13 / §16. If you find cache-correctness issues, there's no "current spec" to compare actual behavior against.
- **All tracks:** Project memory rule about docs being a pre-push gate has zero enforcement. A finding from any track that mandates a docs update can't be machine-verified; recommendations should explicitly call out "and add the corresponding pre-push check."

---

*Audit by Track 7. Read-only. No files mutated.*

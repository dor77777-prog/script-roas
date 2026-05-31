# Exact Mockup Migration (mesh light + dark) — Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the live dashboard to *exactly* match the approved `mesh` (light) + `dark-mesh` (dark) mockup — every color, surface, button, chip, and table — in both themes, leave **no trace of any prior design** in the code, convert the Campaign view from an edge-drawer to a centered modal (ads stay a drawer over it), and ship it in **one** deploy without harming data, layout, or correctness.

**Architecture:** The global token system (`globals.css` `:root`=dark / `[data-theme="light"]`=light, wired through `tailwind.config.ts`) already matches the mockup for ~85% of tokens. The remaining gap is: (a) a handful of missing/drifted global tokens, (b) ~143 component-level hardcoded-color violations (many in **dead** prior-design files that we simply delete), (c) stale glass-era comments, and (d) the Campaign-drawer→modal layout change. We fix the token layer first, delete dead code, strengthen the guards so they *enforce* the mockup, mechanically fix every live violation, convert the drawer, verify both themes on every tab locally, then deploy once.

**Tech Stack:** Next.js (App Router) + Tailwind (CSS-variable color strategy) + Radix Dialog (Sheet/modal) + Recharts + Vitest + Playwright (dark+light visual snapshots) + ESLint custom rules.

---

## Operating constraints (operator standing instructions — non-negotiable)
1. **NO drip-deploy.** Audit everything → fix all → verify every tab in **both** themes **locally** → **ONE** deploy. (Memory: `feedback_no_drip_deploy`.)
2. **Match the mockup EXACTLY** — backgrounds, text, buttons — not "similar". Source of truth = `docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html` directions `mesh`/`dark-mesh` + `campaign-drawer-mockup.html`.
3. **Guards must ENFORCE the design, never block it.** If a lint rule/test conflicts with matching the mockup, *strengthen or update* the guard — never break data/functionality/correctness.
4. **No info loss across tabs** (memory `feedback_no_info_loss_across_tabs`): every card/section/data point preserved on every tab. This plan only re-skins + relayers the drawer; it deletes only UNREFERENCED prior-design files.
5. Commit directly to `main`, no feature branch (memory `feedback_prefer_main_no_branch`); push only at the single-deploy step.

## Source-of-truth artifacts
- Mockups: `docs/superpowers/mockups/2026-05-31-light-reskin/{dashboard-mockups.html, campaign-drawer-mockup.html, home.html}`. **Authoritative pair = `mesh`/`dark-mesh` in dashboard-mockups.html.** (`home.html` is an older single-direction page using violet — **mesh/dashboard wins** wherever they disagree.)
- Visual reference shots (all 7 tabs + campaign modal + ads drawer, both modes): `docs/superpowers/specs/2026-05-31-reskin-research/mockup-*.png`.
- Full research dataset (token reconciliation + 143-finding audit + inventory): `docs/superpowers/specs/2026-05-31-reskin-research/RESEARCH-RAW.json`.

## Resolved decisions (locked this session)
- **Accent in light = TEAL `#0ea5b7` (gallery `mesh` authoritative); dark = VIOLET `#7c6cff`.** The `campaign-drawer-mockup.html` shows violet-in-light — that file predates the teal decision; the drawer **inherits the canonical accent** (teal in light). *(Operator: flag if you want violet-in-light instead — see Wave 0.)*
- **Campaign view → centered modal** (mockup), **Ads = drawer that opens over it.** On mobile the campaign modal is a **full-screen sheet**. The **⤢ expand button is removed** (only X close). *(Operator-confirmed this session.)*
- **Delete the 18 dead prior-design files** ("no trace of previous designs"). *(Derived from operator instruction "לא להשאיר זכר לעיצובים קודמים בקוד".)*
- Bundle the already-committed HELD fix `16fbed7` (flat cards + calm wash) into this single deploy.

## File structure (what changes)
- `dashboard-web/src/app/globals.css` — add tokens, fix drifts, fix date-picker light bug, clean stale comments.
- `dashboard-web/tailwind.config.ts` — expose new tokens (accent-soft/bg, surface-sunken, scrim, shadow-soft), bump radii, clean stale comments.
- `dashboard-web/src/components/ui/Sheet.tsx` — add `variant="modal"` (centered, flat glass-1, zoom entrance, mobile full-screen sheet).
- `dashboard-web/src/components/campaign-drawer/index.tsx` — use modal variant + flat surface + **remove ⤢ expand**.
- `dashboard-web/src/components/AdsDrawer.tsx` — unchanged behavior (stays `side="end"` drawer); verify nested over modal.
- ~22 live components — mechanical color→token swaps per the embedded tables.
- **DELETE** 18 dead files + their tests.
- `eslint` design-guard rule + token/snapshot tests — strengthened to enforce the mockup.
- Docs: `docs/ROAS-Dashboard-User-Manual.md` (+ `docs/ARCHITECTURE.md` for the drawer→modal change).

---

# WAVE 0 — Global token foundation

### Task 0.1: Add the missing mockup tokens

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`:root` dark block ~line 105-231 AND `[data-theme="light"]` block ~line 253-394)
- Modify: `dashboard-web/tailwind.config.ts` (`colors` + `boxShadow` + `borderRadius`)
- Test: `dashboard-web/src/**/__tests__/themeParity.test.ts` (existing — every token must exist in BOTH blocks)

- [ ] **Step 1: Add a failing themeParity expectation.** Add the new token names to the themeParity required-token list so the test FAILS until both blocks define them.

Tokens to add (dark value / light value):
| token | dark (`:root`) | light (`[data-theme="light"]`) | purpose |
|---|---|---|---|
| `--accent-soft` | `rgba(124,108,255,0.16)` | `#def5f7` | icon-chip bg, operator accent-panel, mapped-product pill |
| `--accent-bg` | `rgba(124,108,255,0.12)` | `rgba(14,165,183,0.10)` | the `bg-accent/NN` tint use-sites (alpha-safe) |
| `--surface-sunken` | `#191d31` | `#f1f3f9` | recessed wells: seg track, goalbar/health track, kstrip inset (mockup `--surface-sunken`) |
| `--scrim` | `rgba(0,0,0,0.6)` | `rgba(22,26,48,0.45)` | modal/overlay scrims (replaces raw `bg-black/60`) |
| `--shadow-soft` | `0 1px 2px rgba(0,0,0,0.3)` | `0 1px 2px rgba(22,26,48,0.05)` | lighter button/pill/filterbar shadow (mockup `--sh-soft`) |

- [ ] **Step 2: Run `npx vitest run themeParity` → FAIL** (tokens missing).
- [ ] **Step 3: Add all 5 tokens to BOTH globals.css blocks** with the exact values above (respect the "no literal curly brace in comments" convention the brace-walker relies on).
- [ ] **Step 4: Expose in `tailwind.config.ts`:** `colors.accent.soft='var(--accent-soft)'`, `colors.accent.bg='var(--accent-bg)'`, `colors.surface.sunken='var(--surface-sunken)'`, `colors.scrim='var(--scrim)'`, `boxShadow.soft='var(--shadow-soft)'`.
- [ ] **Step 5: Run `npx vitest run themeParity glassTokens chartTokens` → PASS.**
- [ ] **Step 6: Commit** `feat(tokens): add accent-soft/accent-bg/surface-sunken/scrim/shadow-soft mesh tokens (both themes)`

### Task 0.2: Fix token DRIFTS to exact mockup values

**Files:** `dashboard-web/src/app/globals.css`, `dashboard-web/tailwind.config.ts`; guard tests `colorCollisions.test.ts`, `chartColors.test.ts`.

- [ ] **Step 1:** Apply these exact edits (each is a value change; keep both-theme parity):
  - `--radius-card`: `0.875rem` → **`1.125rem` (18px)** in BOTH blocks (mockup `.card/.store/.kpi` = 18px). The band `::before` bar radius follows automatically (globals.css:649).
  - `--radius-hero`: `1rem` → **`1.125rem` (18px)** (mockup uses one radius for large surfaces).
  - `--radius-control`: `0.5rem` → **`0.625rem` (10px)**; `--radius-chip`: `0.375rem` → **`0.6875rem` (11px)** (mockup pills/chips/buttons are 10–11px). Verify against chips after — chip 6→11 is the most visible.
  - Dark `--glass-edge`: `rgba(255,255,255,0.09)` → **`rgba(255,255,255,0.08)`** (mockup `--border` dark).
  - `--chart-pin-line`: `#f59e0b` → **`#f4a200`** (both blocks; mockup pin = google-amber). **Then run `colorCollisions.test.ts`** — if it trips on pin↔google hue, update the guard's documented exception (pins render only as vertical chart lines, never on chips/edges), do not revert.
  - Light `--band-orange`: `#f97316` → **`#f59e0b`**; light `--band-blue`: `#2563eb` → **`#3b82f6`** (mockup history `.roas-cell` legend). Re-run `colorCollisions` + `chartColors`.
  - `--accent` / `--accent-deep`: pin to literal mockup hex for exactness — light `--accent:#0ea5b7` / `--accent-deep:#0e8a99`; dark `--accent:#7c6cff` / `--accent-deep:#a99cff` (**dark accent-deep LIGHTENS** to `#a99cff` per mockup `--accent-ink`; verify the primary-button dark gradient `accent→accent-deep` still reads — mockup uses this lighter-bottom gradient).
  - Dark `--accent-fg`: `oklch(99% 0 0)` → **`oklch(100% 0 0)`** (parity with light).
  - Light `--shadow-glass` 2nd layer: `rgba(22,26,48,0.07)` → **`rgba(22,26,48,0.06)`** (mockup `--sh-card`).
- [ ] **Step 2:** Run `npx vitest run` for all token/color guards → PASS (update any guard threshold that is "mockup-locked", never weaken semantics).
- [ ] **Step 3: Commit** `fix(tokens): align radius/edge/accent/band-orange-blue/pin/shadow to exact mesh+dark-mesh values`

### Task 0.3: Fix the date-picker `invert(1)` light-mode bug (REAL bug, not cosmetic)

**Files:** `dashboard-web/src/app/globals.css:507-515`

- [ ] **Step 1:** The rule `input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }` assumes a dark bg → in light mode it turns the dark glyph white-on-white. Scope the invert to dark only: keep `filter: invert(1)` under `:root` (dark) and add `[data-theme="light"] input[type="date"]::-webkit-calendar-picker-indicator { filter: none; }`.
- [ ] **Step 2:** Verify in chrome-devtools both themes that the date glyph is visible.
- [ ] **Step 3: Commit** `fix(ui-ux): date-picker glyph no longer inverts to white-on-white in light mode`

### Task 0.4: Erase stale glass-era / prior-design narration (comment-only)

**Files:** `dashboard-web/src/app/globals.css`, `dashboard-web/tailwind.config.ts`

- [ ] **Step 1:** Rewrite/replace these stale comments (values stay; comments only). No behavior change.
  - globals.css **5-14** header: replace "OKLCH-based, SINGLE-MODE (dark only)… glass+neon (Vision UI flagship)… Source-of-truth: mockup-04-final.html" with: *dual-mode (dark=`:root`, light=`[data-theme="light"]`), flat **mesh** re-skin, source-of-truth = `docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html` (mesh / dark-mesh).*
  - Replace every `mockup-04-final.html` / `mockup-04f-v4-final.html` / `mockup-05-freshness-desaturation.html` / `mockup-04i-store-emphasis.html` reference (globals.css lines ~169, 613, 631, 961, 996, 1081, 1095) with the current light-reskin mockup path + correct selector.
  - globals.css ~113/326 "violet rim on hover/focus/active glass" → "accent rim (violet dark / teal light)".
  - globals.css 445 "Scrollbars — translucent on dark canvas" → "…both themes".
  - globals.css 615 ".glass base … blur+saturate via --blur-glass" → note `.glass` no longer applies backdrop-filter (cards are opaque mesh surfaces); `--blur-*` now serves only topbar/sticky-header/tooltip/sheet.
  - tailwind.config.ts 28 "single-mode" + 35 "white-alpha stack" + 48 "Tuned for dark-canvas legibility" → describe dual-mode opaque mesh surfaces / both-theme tuning.
- [ ] **Step 2:** **Do NOT** rename `--glass-*`→`--surface-*` or `.glass`→`.card` (touches hundreds of consumers + lint + tests — deferred, behavior-risk). Add a one-line note: *"'glass' is legacy naming for the opaque mesh surface tokens; rename deferred to a tracked task."*
- [ ] **Step 3:** `darkMode: ['selector','[data-theme="dark"]']` (tailwind.config.ts:24) + `--blur-*`/`backdrop-filter` — **leave values untouched** (removing risks behavior); only annotate. Confirm zero `dark:*` utilities exist before considering removal (`grep -rn "dark:" dashboard-web/src/components` → expect none design-relevant).
- [ ] **Step 4: Commit** `docs(globals): erase stale glass+neon/single-mode/mockup-04 narration; mesh is canonical`

---

# WAVE 1 — Delete dead prior-design code ("no trace of previous designs")

### Task 1.1: Verify-then-delete the 15 prior-design components

**Files to DELETE (15, all under `dashboard-web/src/components/`):**
`HomeLiveBand.tsx`, `HomePerStoreBand.tsx`, `HomeSummaryBand.tsx`, `HeroOverview.tsx`, `KpiCards.tsx`, `PerStoreCards.tsx`, `TodayLive.tsx`, `CollapsibleSection.tsx`, `Sparkline.tsx` (root dup of `ui/Sparkline`), `RollingNumber.tsx`, `MetricHelp.tsx`, `InsightsPanel.tsx`, `WhatsWorking.tsx`, `QuadrantScatter.tsx`, `TabNav.tsx`.

**VERIFIED import-graph (2026-05-31) — this is a self-contained DEAD cluster, the OLD Home design:**
- Roots `HomeLiveBand` / `HomePerStoreBand` / `HomeSummaryBand` have **ZERO importers** (nothing renders them).
- `HeroOverview`←HomeSummaryBand · `KpiCards`←HomeSummaryBand · `TodayLive`←HomeLiveBand · `PerStoreCards`/`CollapsibleSection`←HomePerStoreBand · `RollingNumber`/`MetricHelp`←KpiCards · `InsightsPanel`/`WhatsWorking`/`TabNav` zero importers · `QuadrantScatter` test-only. Every edge stays inside the cluster.
- LIVE replacements (STAY): `Dashboard.tsx` renders `home/CommandCenterHero` + `home/PerStoreRow` (Home), `Sidebar` (nav; `<TabNav>` has 0 JSX usages), `InsightsBoard` (insights). Dashboard's own local `QuadrantScatterCard` (Dashboard.tsx:878) is SEPARATE & live — deleting the `QuadrantScatter.tsx` FILE does not touch it.
- **Util exports inside dead files have NO live consumer** (verified): `computeKpiSparkData` (KpiCards), `selectLeaderAndRisk` (PerStoreCards), `METRIC_HELP` (MetricHelp) are used only by their dead component + its own test → they die with the cluster.

**Orphaned test/spec files to delete WITH the components** (they import dead files / dead utils — they test dead code):
`src/lib/__tests__/kpiCardsSparkData.test.ts`, `src/lib/__tests__/kpiCardsSparkDataCogsRate.test.ts`, `src/lib/__tests__/perStoreLeaderRisk.test.ts`, `src/components/__tests__/QuadrantScatter.dom.test.tsx`, and `src/components/__tests__/bidi.dom.test.tsx` **IF** it only renders dead `PerStoreCards` (check first — if it also renders LIVE components, migrate those assertions to `home/PerStoreRow` instead of deleting). Plus any colocated `*.test.tsx`/`__snapshots__` for the 15 components.

- [ ] **Step 1: Re-prove dead before deleting.** For each component run `grep -rn "/<Name>'" dashboard-web/src --include="*.tsx" --include="*.ts" | grep -v "/<Name>.tsx:"` and confirm every importer is itself in the dead list or a test file. If ANY **live** importer appears → STOP, do not delete, report.
- [ ] **Step 2: Delete leaves → roots.** Delete in dependency order: HeroOverview, KpiCards, RollingNumber, MetricHelp, PerStoreCards, CollapsibleSection, TodayLive, Sparkline (root), InsightsPanel, WhatsWorking, QuadrantScatter, TabNav → then the 3 `Home*Band` roots. Delete the orphaned test files listed above in the same step.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS (no dangling imports). `npx vitest run` → PASS. If a test fails because it imported a deleted file: if it tested DEAD code, delete it; if it tested LIVE behavior, you mis-classified — restore and report. **Never** weaken a real test.
- [ ] **Step 4: Commit** `chore(cleanup): delete 15 dead prior-design components + orphaned tests — no trace of previous design`

### Task 1.2: Delete 3 unused `ui` primitives

**Files:** `dashboard-web/src/components/ui/Dialog.tsx` (Sheet is used instead), `ui/Select.tsx` (NativeSelect used instead), `ui/chart/ChartLegend.tsx` (test-only).

- [ ] **Step 1:** Same dead-proof grep as 1.1 Step 1 for each. **NOTE:** Wave 4 introduces a modal via `Sheet`, NOT `ui/Dialog` — confirm Wave 4 does not resurrect `Dialog.tsx` before deleting (it doesn't; modal is a Sheet variant).
- [ ] **Step 2:** Delete + colocated tests.
- [ ] **Step 3:** `npx tsc --noEmit` + `npx vitest run` → PASS.
- [ ] **Step 4: Commit** `chore(cleanup): delete unused ui/Dialog, ui/Select, ui/chart/ChartLegend primitives`

---

# WAVE 2 — Strengthen the guard, then fix `ui` primitives

### Task 2.1: Add the design-color guard as a GREEN RATCHET (shrinking allowlist)

**Files:** new `dashboard-web/src/**/__tests__/designColorGuard.test.ts` (vitest sweep). (At Wave 5.1 the same patterns also get wired into the ESLint `no-hex-color-in-components` family for editor/CI enforcement.)

- [ ] **Step 1:** Write a vitest guard that scans `src/components/**/*.tsx` (exclude `*.test.tsx`/`*.stories.tsx`) for FORBIDDEN patterns: `bg-white|text-white|border-white|fill-white|divide-white`, `white/[0-9]`, `black/[0-9]`, raw named palette `(text|bg|border|from|to|via|ring|fill|stroke|divide|placeholder)-(gray|slate|zinc|neutral|stone|emerald|rose|amber|red|blue|green|teal|violet|indigo|purple|pink|orange|yellow|cyan|sky|lime|fuchsia)-[0-9]`, inline `#hex` in className/style, and **slash-alpha on flat tokens** `(bg|text|border|ring)-(accent|canvas|ink|status-[a-z]+)/[0-9]`. ALLOW `var(--token)`, `color-mix(… var(--…))`, `oklch(from var(--…) …)`, arbitrary `[color:var(--…)]`, and `bg-accent-bg`/`text-accent-fg`/`bg-accent-soft` (the new tint tokens).
- [ ] **Step 2 (ratchet):** The guard has a `MIGRATION_ALLOWLIST` of files NOT yet migrated. It **FAILS** if (a) any NON-allowlisted file has a violation (regression guard), OR (b) an allowlisted file has ZERO violations (forces shrinking — when you fix a file you MUST remove it from the list). Seed `MIGRATION_ALLOWLIST` by running the scan and listing exactly the files that currently violate. This keeps the FULL vitest suite GREEN now; every Wave-3 task removes its file(s) from the list; Wave 3.9 = list empty.
- [ ] **Step 3:** `npx vitest run designColorGuard` → PASS (green, with the seeded allowlist). **Commit** `test(guard): design-color green-ratchet guard (shrinking allowlist)`

### Task 2.2: Fix `ui` primitives — Stat, InsightCard

**Files:** `dashboard-web/src/components/ui/Stat.tsx`, `ui/InsightCard.tsx`

- [ ] **Step 1:** Apply exact swaps:
  - Stat.tsx:74 `text-white/65` → `text-ink-secondary` (P0 light)
  - Stat.tsx:98 `text-orange-200` → `text-status-orangeFg`
  - Stat.tsx:99,100 `text-white` → `text-ink` (P0 light)
  - InsightCard.tsx:76,83,90,97 `text-white` (badge on solid status/accent) → `text-accent-fg`
  - InsightCard.tsx:104 count-pill `text-white` on `bg-ink-muted` → `text-accent-fg`
- [ ] **Step 2:** Guard on these two files → no findings. `npx vitest run ui` (Stat/InsightCard DOM tests) → PASS.
- [ ] **Step 3: Commit** `fix(ui): Stat + InsightCard token-driven foregrounds (legible in light)`

---

# WAVE 3 — Per-tab live-component color fixes

> Each task = one component group. Apply the exact `current → replacement` swaps from the audit (full P2 list in `RESEARCH-RAW.json`). After each task: run the Wave-2 guard scoped to those files (zero findings) + `npx tsc --noEmit` + the file's tests → PASS, then commit. **`text-white` on a solid `bg-accent`/status fill → `text-accent-fg`** is the canonical swap throughout.

### Task 3.0: Per-store card (`home/PerStoreRow.tsx`) — EXACT structural + appearance fidelity vs mockup (operator-mandated)

> Operator requirement (2026-05-31): **every per-store card on Home must match the mockup `.store` card EXACTLY in structure AND appearance** — all texts, headers, colors, and the per-platform CPM cells — with only the band color driven by ROAS. Reference: `docs/superpowers/specs/2026-05-31-reskin-research/mockup-{mesh-light,dark-mesh}-home.png` + the mockup `.store` rule (research RESEARCH-RAW.json: radius 18px, padding 17px, white text on vivid band gradient; band-tag pill `rgba(255,255,255,.22)`/`#fff`; big ROAS ~50px white; `hr rgba(255,255,255,.22)`; per-platform `.plat` tiles `bg rgba(255,255,255,.16)` border `rgba(255,255,255,.18)` r11px). Band color via `useRoasBandGradient(roas,isStale)`. Honour memory `feedback_home_visual_rules` (Spend always red ↓, Revenue always green ↑, AOV conditional $>70 green ▴ / $<50 red ▾ / $50–70 neutral, Orders neutral) + `feedback_freshness_desaturation_thresholds`.

**Files:** `dashboard-web/src/components/home/PerStoreRow.tsx` (+ any per-store CPM-cell subcomponent). PerStoreRow is token-clean (0 color violations) — this task is **structure/appearance fidelity**, not a color swap.

- [ ] **Step 1:** Render the live Home (empty-state OK for layout) + open `mockup-mesh-light-home.png` / `mockup-dark-mesh-home.png`. Diff EACH per-store card element vs mockup `.store`: (a) header = store name + platform badge + ROAS band chip/tag + LIVE/freshness chip; (b) big ROAS number band-colored white-on-gradient; (c) the 4-up metric grid labels + values (spend ↓red, revenue ↑green, orders neutral, AOV conditional) in the SAME order/labels as the mockup; (d) the per-platform CPM cells (Meta/Google/TikTok: brand dot + spend caption + CPM value) — same layout, brand colors, and labels as the mockup. List every divergence (missing label, wrong order, wrong caption, wrong CPM cell layout, wrong text).
- [ ] **Step 2:** Fix each divergence in `PerStoreRow.tsx` so the rendered card is structurally + visually identical to the mockup in BOTH themes. Do NOT change any data/derivation — only structure/labels/styling. Keep band color driven by ROAS.
- [ ] **Step 3 (RTL coverage, closes the gap from the Wave-1 bidi-test deletion):** add a DOM test asserting `PerStoreRow` wraps the store name in `<bdi dir="ltr">` (the deleted `bidi.dom.test.tsx` asserted this on the now-removed `PerStoreCards`; re-establish it on the live component).
- [ ] **Step 4: Verify (chrome-devtools, both themes)** the per-store row matches the mockup exactly. `npx vitest run` + guard scoped to PerStoreRow → PASS. **Commit** `fix(home): per-store cards exact structural+appearance parity with mockup + bidi store-name coverage`

### Task 3.1: Home tab — CommandCenterHero, RoasTargetChart, ActivityFeed, GoalTracker, SyncIndicator

- [ ] GoalTracker.tsx:136 `from-accent/95 to-accent/80` (silent alpha-drop) → explicit `bg-[linear-gradient(135deg,var(--accent),var(--accent-deep))]`; `text-white`→`text-accent-fg`
- [ ] GoalTracker.tsx:155 `bg-white hover:bg-white/95` CTA (the K-kbd bug class) → `Button variant` inverted, or `bg-surface-elevated-1 text-accent`
- [ ] GoalTracker.tsx:169,239,257 `bg-accent/10` → `bg-accent-bg`; :334,354 `bg-ink/40` → `bg-ink-muted`; :141 icon-chip `bg-white/12`→`bg-accent-soft`, `text-white`→`text-accent-fg`; :144,148 `text-white`/`text-white/75` → `text-accent-fg`
- [ ] SyncIndicator.tsx:74 `bg-white/12 text-white/85` (P0 light) → `bg-glass-2 text-ink-secondary hover:bg-glass-3`; :82 `bg-white/15 text-white`→`bg-glass-2 text-ink`; :87 `bg-status-red/85`→`bg-status-red`; :95 `bg-status-warning/30`→`bg-status-warningBg text-status-warningFg hover:bg-status-warning`; :100 `bg-emerald-500/30`→`bg-status-greenBg text-status-greenFg hover:bg-status-green`; :131 `ring-white/10`→`ring-glass-edge`
- [ ] RoasTargetChart.tsx:139 ROAS-band KPI uses `text-status-*` for ANALYTIC grading → use `text-band-red/orange/green` (match the existing `text-band-blue` arm); :473,563 drop the `oklch(...)` literal fallback → `fill:'var(--text-subtle)'`; :664,368 prev-delta/milestone use status for delta → `text-[color:var(--up)]`/`[color:var(--dn)]`
- [ ] CommandCenterHero.tsx:773 delta uses `text-status-green/red` → `text-[color:var(--up)]`/`[color:var(--dn)]` (analytic delta, not operational)
- [ ] **Verify (chrome-devtools, both themes) at `/dev/primitives` + empty-state Home; Commit** `fix(home): token-driven Home — GoalTracker/SyncIndicator/charts legible both themes`

### Task 3.2: P&L + Analysis **tables** — PnLBreakdown, MonthlyTables, AttributionAnalysisPanel, InsightsBoard

> The operator explicitly requires the **monthly tables + summary table** to be exact. The mockup history `.roas-cell` legend = red `#e11d48` / orange `#f59e0b` / green `#0f9d6b` / blue `#3b82f6`; **failure "0" cell = bg `#15151f` + pink `#ff8a9a` text** (NOT pure black/white). Reconcile `--cell-fail` to `#15151f`/`#ff8a9a` (Task adds it to globals if MonthlyTables needs it — verify the rendered "0" cell matches the mockup's dark-navy+pink, both themes).

- [ ] PnLBreakdown.tsx:60 `text-blue-700`→`text-status-blueFg`; :61 `text-purple-700`→`text-accent`; :156 `via-elevated to-elevated` (DEAD color key — renders nothing!) → `via-glass-1 to-glass-1`; :160 `text-white`→`text-accent-fg`
- [ ] MonthlyTables.tsx:298 active-Tab `text-white`→`text-accent-fg`; **verify** the 4 ROAS band cells + black-"0" failure cell render exactly per mockup in both themes (cell colors come from `lib/format/roasCell.ts` — confirm it maps to band/status + `--cell-fail`).
- [ ] AttributionAnalysisPanel.tsx:133 `bg-white/40` track (P0 light, near-invisible) → `bg-glass-2`; :160 callout `bg-white/40`→`bg-glass-1/60`
- [ ] InsightsBoard.tsx:63 `text-white`→`text-status-redFg`; :71→`text-status-warningFg`; :79→`text-accent-fg`; :87→`text-status-greenFg`; :95 info badge on `bg-ink-muted` `text-white`→`text-canvas` (legible in light); :240 `via-elevated to-elevated`→`via-glass-1 to-glass-1`; :241 `hover:to-elevated2/40`→`hover:to-glass-2/40`
- [ ] **Verify (both themes) the History monthly tables + summary + Trends; Commit** `fix(analysis): exact monthly-table band cells + P&L/Insights tokens; fix dead 'elevated' gradient`

### Task 3.3: Campaigns — CampaignsTable, CampaignsTableRow

- [ ] CampaignsTableRow.tsx:297 `bg-purple-100 text-purple-700` (ABO chip, breaks dark) → `bg-accent/10 text-accent` (mirror CBO) — wait, accent slash-alpha: use `bg-accent-bg text-accent`
- [ ] CampaignsTable.tsx:1252,1370 `text-white` on accent → `text-accent-fg`
- [ ] Bespoke `<a>` Ads-Manager deep-links (CampaignsTableRow:764, campaign-drawer/index.tsx:834) — token-driven already (`text-accent`); **leave as anchors** (navigation, not buttons). No change.
- [ ] **Verify (both themes) Campaigns table + KPI strip + winners/watch; Commit** `fix(campaigns): ABO chip + accent foregrounds token-driven`

### Task 3.4: Products / Detail — ProductCentricView, ProductPickerModal

- [ ] ProductCentricView.tsx:88,92,511,524,540,557,586,602 — `text-canvas[/NN]` used as INK on tooltip surfaces (8× **P0 both** — page-bg color as text) → `text-ink-muted` (88), `text-ink`/`text-ink-secondary` (92), `text-ink-secondary` (511/524/540/557/586/602)
- [ ] ProductCentricView.tsx:607 `text-emerald-300`→`text-status-greenFg`; :609 `text-orange-300`→`text-status-orangeFg`; :611,612 `text-red-300`→`text-status-redFg`
- [ ] ProductPickerModal.tsx:341 `text-white` on accent checkbox → `text-accent-fg`
- [ ] **Verify (both themes) Products + Detail tooltips; Commit** `fix(products): ProductCentricView tooltip ink (8 P0 light-mode breaks) + legend swatches`

### Task 3.5: Chrome — Sidebar, CommandPalette, AiReportButton, TabFreshnessHeader

- [ ] CommandPalette.tsx:545 `bg-white/10 hover:bg-white/15 active:bg-white/20` (P0 light) → `bg-glass-2 hover:bg-glass-3 active:bg-surface-elevated-1`; :546 `border-white/15 text-white/85`→`border-glass-edge text-ink-secondary`; :554 Cmd-K kbd `bg-white/15 border-white/15` (**the known K-kbd white-on-white bug**) → `bg-glass-2 border-glass-edge`
- [ ] Sidebar.tsx:114 `hover:bg-white/[0.06]` (on the DARK rail — keep readable in both since rail is always dark) → `hover:bg-[color-mix(in_oklab,var(--sidebar-fg)_8%,transparent)]`; :127,207 `border-white/10`→`border-[color-mix(in_oklab,var(--sidebar-fg)_12%,transparent)]`; :476 `bg-canvas` (mobile drawer) → `bg-canvas-1`
- [ ] AiReportButton.tsx:176 `bg-black/40` mobile backdrop → `bg-scrim` (new token)
- [ ] **Verify (both themes) topbar/search/K-kbd, sidebar rail, command palette; Commit** `fix(chrome): K-kbd + command palette + sidebar rail token-driven (light-mode legible)`

### Task 3.6: Operator — all `operator/*`

- [ ] OperatorSecretBanner.tsx:104 `text-white` on `bg-status-orange` (sub-AA) → `text-accent-fg`; :115 `bg-canvas`→`bg-glass-1`
- [ ] ResetData.tsx:212 `text-white`→`text-accent-fg`; :256 `bg-black/60` scrim→`bg-scrim`; :337 `bg-canvas`→`bg-glass-2`; remove the stale "no destructive/orange token" comment (L96-98 — status tokens now exist)
- [ ] ManualOverridesCrud.tsx:361 `bg-black/60` scrim → `bg-scrim`
- [ ] WhatsappTestButtons.tsx:111,112 `text-white` on warning/green → `text-accent-fg`; `ring-offset-canvas`→`ring-offset-[color:var(--canvas-1)]`
- [ ] SyncNowButtons.tsx:157 `text-white` on `bg-accent/70` → `text-accent-fg`
- [ ] StatusEventsFeed.tsx:41 `text-blue-400`→`text-status-blue`
- [ ] FreshnessPanel.tsx:116, JobsTable.tsx:191,237, MetaBucPanel.tsx:132 `bg-canvas` (page-bg misused as surface) → `bg-glass-3` (headers) / `bg-glass-2` (inset)
- [ ] **Verify (both themes) Operator tab; Commit** `fix(operator): scrim token + on-solid foregrounds + canvas→surface misuse`

### Task 3.7: Billing — BillingSettings, BillingCsvImport

- [ ] BillingSettings.tsx:91 `bg-blue-100 text-blue-700`→`bg-status-blueBg text-status-blueFg`; :92 `bg-purple-100 text-purple-700`→`bg-status-grayBg text-status-grayFg` (no violet status token; gray is the dual-mode neutral); :803,819 `text-white`→`text-accent-fg`
- [ ] BillingCsvImport.tsx:332,344 `text-white`→`text-accent-fg`
- [ ] **Verify (both themes); Commit** `fix(billing): status-token badges + accent-fg foregrounds`

### Task 3.8: app pages — layout.tsx theme-color

- [ ] layout.tsx:52 viewport themeColor dark `#0a0c1d`→`#0d0f1e` (= `--canvas-1` dark); :53 light `#f3f4f8`→`#edf0f8` (= `--canvas-1` light); update the stale comment at :49.
- [ ] **Commit** `fix(app): viewport theme-color matches canvas-1 both themes`

### Task 3.9: Guard goes green

- [ ] Run the Wave-2 guard across ALL `*.tsx` → **zero findings** (the red baseline from Task 2.1 is now resolved). If any remain, they are either (a) in a file not yet fixed → fix, or (b) a legitimate token use the guard over-flags → refine the allowlist (never silence a real violation).
- [ ] `npx vitest run && npx tsc --noEmit && npm run lint` → all PASS. **Commit** `test(guard): non-token color guard green across all components`

---

# WAVE 4 — Campaign drawer → centered modal (ads stay a drawer over it)

### Task 4.1: Add a `variant="modal"` to the Sheet primitive

**Files:** `dashboard-web/src/components/ui/Sheet.tsx`; Test: `dashboard-web/src/components/ui/__tests__/sheet.dom.test.tsx`

- [ ] **Step 1: Failing test** — render `<Sheet open><SheetContent variant="modal">…` and assert the content node has the centered-modal classes (not `slide-in-from-end`) and the overlay uses `bg-scrim`.
- [ ] **Step 2: Run → FAIL** (no `variant` prop yet).
- [ ] **Step 3: Implement.** Add a `variant: { drawer, modal }` axis to `sheetVariants` (keep `side` for drawer). For `variant="modal"`:
  - Positioning: `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,920px)] max-h-[88vh] rounded-[var(--radius-hero)]` ; entrance `zoom-in-95 fade-in-0` (not slide).
  - Surface: **flat `bg-glass-1`** (mockup `.drawer` is flat `--surface`) — NOT the `from-glass-3 to-glass-2` gradient. Border `border border-glass-edge`, `shadow-sheet`.
  - **Mobile full-screen sheet:** `max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:h-full max-sm:max-h-none max-sm:rounded-none`.
  - Overlay: `bg-scrim backdrop-blur-sm` (was `bg-glass-3`).
  - `defaultVariants: { variant: 'drawer', side: 'end' }` (back-compat: every existing `<SheetContent>` stays a drawer).
- [ ] **Step 4: Run → PASS.** Also run full `vitest run sheet` (drawer path unchanged).
- [ ] **Step 5: Commit** `feat(ui/Sheet): add centered modal variant (flat glass-1, zoom entrance, mobile full-screen)`

### Task 4.2: Convert CampaignDrawer to the modal + remove ⤢ expand

**Files:** `dashboard-web/src/components/campaign-drawer/index.tsx`

- [ ] **Step 1:** Change `<SheetContent side="end" …>` → `<SheetContent variant="modal" …>` (line ~763). Drop any `side`/fullscreen-width toggle logic specific to the edge drawer.
- [ ] **Step 2: Remove the ⤢ expand control.** `grep -n "expand\|fullscreen\|maximize\|⤢\|Maximize\|Expand" campaign-drawer/index.tsx` → delete the button + its state/handler. Keep only the X close.
- [ ] **Step 3:** The sticky `SheetHeader` (`bg-glass-2/95`) still works inside the modal; verify the header radius matches the modal's top corners (`rounded-t-[var(--radius-hero)] overflow-hidden` on content). All 6 sub-tabs (Overview/Daily/AdSets/Ads/Status/History) render unchanged.
- [ ] **Step 4:** `npx tsc --noEmit` + `vitest run campaign-drawer` → PASS.
- [ ] **Step 5: Commit** `feat(campaigns): Campaign view is a centered modal (mockup) — expand button removed`

### Task 4.3: Keep AdsDrawer as a drawer OVER the modal

**Files:** `dashboard-web/src/components/AdsDrawer.tsx`, `dashboard-web/src/lib/drawerStack.ts`

- [ ] **Step 1:** AdsDrawer keeps `<SheetContent side="end">` (drawer). Confirm it opens **above** the campaign modal: z-index/stack via `drawerStack` so the modal dims behind the ads drawer (mockup shows the campaign window dimmed). If the modal's overlay sits above the ads drawer, raise the ads `SheetContent`/overlay z above the modal layer.
- [ ] **Step 2:** Verify Esc handling: pressing Esc closes the **top** of the stack (ads first, then modal) via `useDrawerEsc`. Focus returns correctly.
- [ ] **Step 3:** DOM test: open modal → open ads → assert both mounted, ads on top; Esc closes ads then modal.
- [ ] **Step 4: Commit** `feat(campaigns): Ads drawer opens over the campaign modal; stacked Esc/focus`

### Task 4.4: Entrance/View-Transition + reduced-motion

**Files:** `dashboard-web/src/app/globals.css` (the `::view-transition-*` + `drawer-panel` rules ~593-609), Sheet motion.

- [ ] **Step 1:** The modal uses a zoom/fade entrance — ensure the `view-transition-name: drawer-panel` morph (if applied to the campaign panel) is either removed for the modal or retuned to a scale (not slide). Keep the ads drawer's slide.
- [ ] **Step 2:** Confirm `prefers-reduced-motion` collapses the modal zoom to instant (global rule already handles `animate-in`; verify no leftover slide keyframe).
- [ ] **Step 3:** Verify in chrome-devtools (desktop + an emulated 390px viewport): desktop = centered modal on dimmed scrim; mobile = full-screen sheet; ads drawer over both; both themes.
- [ ] **Step 4: Commit** `fix(motion): campaign modal zoom entrance + reduced-motion + mobile sheet verified`

---

# WAVE 5 — Guards, verification, single deploy

> **REVISED ORDER (operator 2026-05-31):** local dev has NO real data, so meaningful Playwright visual comparison can only run against production-live. New sequence: **(A)** finish ALL implementation + unit/DOM tests green [Task 5.1] → **(B)** docs [old Task 5.4] → **(C)** a LIGHT local surface sanity pass on `/dev/primitives` + empty states (NOT full local Playwright) [trimmed Task 5.3] → **(D)** ONE deploy to production [Task 5.5 push] → **(E)** Playwright light+dark+mobile WITH real-data comparisons ON PRODUCTION + per-tab visual diff vs the mockup [old Task 5.2, now post-deploy] → fix-and-redeploy only if prod Playwright surfaces a real defect. Do NOT generate/commit local Playwright baselines against empty-state data — generate them against prod.

### Task 5.1: Guards enforce, never block

- [ ] Run the full guard/test suite: `npx vitest run` (incl. `themeParity`, `glassTokens`, `chartTokens`, `colorCollisions`, `chartColors`, the new design-color guard, all DOM tests) + `npx tsc --noEmit` + `npm run lint`. All PASS. Any guard that conflicts with a mockup-exact value is **updated** (with a "mockup-locked" comment), never weakened in semantics.

### Task 5.2: Regenerate Playwright visual snapshots — light AND dark

**Files:** `dashboard-web/playwright.config.*` (+ snapshot dir)

- [ ] **Step 1:** Add a **light** project alongside the existing dark `1440×900` project (the config was dark-only per RESUME-STATE). Add a mobile project (e.g. `390×844`) that opens the Campaign modal to lock the full-screen-sheet behavior.
- [ ] **Step 2:** Regenerate snapshots for every tab in BOTH themes + the campaign modal + ads drawer. Review diffs against the mockup reference shots.
- [ ] **Step 3: Commit** `test(visual): light+dark+mobile Playwright projects; regenerate mesh snapshots`

### Task 5.3: Local both-theme, all-tab verification (NO deploy yet)

> Local dev has **no Supabase creds** → data-backed views are empty/gray locally. Use `/dev/primitives` (band cards, badges, freshness, buttons, chips, tables) + empty-state Home/Campaigns for surface/color checks; reserve data-backed checks for PROD post-deploy.

- [ ] **Step 1:** `npm run dev`; in chrome-devtools toggle `data-theme` light/dark and walk: `/dev/primitives`, Home, P&L, Analysis (Trends + History monthly tables + summary), Campaigns (+ open the **modal** + the **ads drawer**), Products, Detail, Operator. For EACH: compare against the matching `mockup-*.png`. Confirm no white-on-white, no invisible text, exact surfaces/buttons/chips/table cells.
- [ ] **Step 2:** Fix any residual mismatch found visually (loop until clean). Commit fixes individually.

### Task 5.4: Docs currency (pre-push gate)

**Files:** `docs/ROAS-Dashboard-User-Manual.md` (UX change), `docs/ARCHITECTURE.md` (drawer→modal interaction change).

- [ ] **Step 1:** Bump the User Manual (version + changelog): mesh exact-match re-skin, Campaign **modal** + Ads drawer-over, removed expand button, deleted prior-design components. The docs-currency gate fires on any `components/*.tsx` change and requires the User Manual in the push.
- [ ] **Step 2:** Update ARCHITECTURE.md §drawer/modal: CampaignDrawer is now a centered modal (Sheet `variant="modal"`), AdsDrawer is a nested drawer, drawerStack semantics.
- [ ] **Step 3: Commit** `docs: User Manual + ARCHITECTURE — mesh exact re-skin + campaign modal`

### Task 5.5: ONE deploy + PROD verification

- [ ] **Step 1:** Final gate green: `npx tsc --noEmit && npx vitest run && npm run lint && npx playwright test`. The pre-push hook runs tsc+vitest+lint+docs-currency.
- [ ] **Step 2:** `git push origin main` (single deploy; Vercel build ≈ 2–4 min). Poll: `curl -s <prod>/ | grep css link → fetch css → grep a NEW marker` (e.g. `#15151f` cell-fail or `--accent-soft`) to confirm the deploy is live.
- [ ] **Step 3: PROD verification with REAL data, both themes, EVERY tab vs the mockup:** Home (per-store + hero + ROAS chart), P&L (GoalTracker + P&L waterfall), Analysis (Trends multi-store line + History monthly tables 4-band cells + black-"0" + summary), Campaigns (winners/watch, KPI strip, dense table A/B/C/D badges + sparklines + ROAS cells + reconciliation) + **Campaign modal** (6 sub-tabs, charts Spend↔Value green/red + CPM, health bars) + **Ads drawer** (two band ROAS columns, black-0, learning chip, status dots), Products, Detail, Operator. Confirm pixel-match to `mockup-*.png` in both modes; no data/correctness regression.
- [ ] **Step 4:** Update memory (`project_reskin_paused_2026_05_31` → shipped) + RESUME-STATE.

---

## Self-Review (run after writing — author checklist)
1. **Spec coverage:** every research finding routed → Wave 0 (tokens/drifts/stale comments/date-picker bug), Wave 1 (18 dead files), Waves 2–3 (all live P0/P1/P2 incl. the monthly/summary tables), Wave 4 (modal + ads drawer + remove expand + mobile sheet), Wave 5 (guards/visual/docs/deploy). ✔
2. **Operator additions covered:** monthly tables (3.2) ✔, summary table (3.2) ✔, ads drawer (4.3) ✔, campaign→modal (4.1–4.4) ✔, all tabs exact (5.3/5.5) ✔, no trace of old design (Wave 1 + 0.4) ✔.
3. **Decisions locked:** teal-light accent (flag), mobile full-screen sheet, expand removed, delete dead files, single deploy. ✔
4. **Type consistency:** `variant="modal"` (Sheet) used identically in 4.1/4.2; `text-accent-fg`/`bg-accent-bg`/`bg-scrim`/`--surface-sunken` names consistent across tasks. ✔
5. **No data/correctness risk:** all changes are color/token/comment/presentation; deletions are unreferenced-verified; guards updated not weakened. ✔

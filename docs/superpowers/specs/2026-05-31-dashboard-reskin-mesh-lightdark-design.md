# Dashboard Re-skin — "Mesh Rich Gradient", Light + Dark — Design Spec

**Date:** 2026-05-31
**Status:** Draft for review
**Author:** brainstorming session (mockup-driven)
**Supersedes the look of:** the shipped glass+neon "Premium 2026" redesign (rejected by the operator as visually unsatisfying).

---

## 1. Goal & scope

Re-skin the entire ROAS dashboard to a new visual language — **"mesh rich gradient"** — that ships in **both light and dark mode** with a runtime toggle.

**This is a RE-SKIN, not a redesign.** Every tab's information architecture, layout, component composition, and data points stay **1:1** (per the standing "no info loss across tabs" rule). Only the *visual language* changes: surfaces, palette, gradients, the way the ROAS signal is rendered, platform-color emphasis, charts polish, and mobile responsiveness.

**Non-goals (explicitly out of scope):**
- No changes to IA / navigation / tab structure / what lives on each tab.
- No new features, no data-model or pipeline changes, no algorithm changes (ROAS-band thresholds stay).
- No removal/hiding of any card, section, table column, or metric. Reorganization within a card is allowed only if it preserves every datum.

**Reference artifact:** the approved interactive mockup at
`docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html`
(direction switcher × tab switcher; chosen direction = **`mesh`** in light + **`dark-mesh`** in dark).

---

## 2. The visual language

### 2.1 Base & surfaces
- **Two themes, one token contract.** Neutral base surfaces; color used as an **accent**, never as a full-card flood — *except* the ROAS-signal cards (see 2.2).
  - **Light:** canvas = cool off-white/gray (`oklch ~96%`); cards = white with hairline borders + soft shadow; dark slim sidebar.
  - **Dark:** canvas = deep navy (`~oklch 13%`); cards = elevated navy; light ink.
- **Mesh gradient wash** on the page background (a soft multi-stop radial/conic), forked per theme — calm in light, richer in dark. This is the namesake "mesh".
- Generous whitespace, clear type hierarchy, restrained accent (violet primary; blue/teal acceptable per-theme).

### 2.2 ROAS-signal cards (the one place color floods)
Per-store cards (Home `PerStoreRow`) and the global business KPI hero (Home `CommandCenterHero`) stay **colored by ROAS band**, now rendered as a **rich multi-stop gradient** (the "mesh" card) with white text — tasteful, not neon. Bands (unchanged thresholds):

| Band | ROAS | Hue |
|---|---|---|
| red | `< 2.0` | red |
| orange | `2.0 – 2.7` | orange |
| green | `2.7 – 3.0` | green |
| blue | `≥ 3.0` | blue |
| gray | null/no-data | gray |

- Strong strength on the headline cards (per-store, Operating-Profit hero, ROAS hero); **muted** strength on the secondary KPI cards so a same-band row never becomes one solid blob (existing `data-band-strength` contract).
- 3-stage **freshness desaturation** stays (fresh <15m / aging 15–30m / stale >30m), but **must not desaturate the platform dots** (see 2.4).

### 2.3 ROAS-band cells in tables
Tables that grade ROAS per row/day (Detail, Monthly/Archive, Campaigns) keep the **4-band colored ROAS cell**. The **spend-but-no-sale "failure" day** is a distinct **black `'0'`** cell.
- **Decision (reconcile existing discrepancy):** standardize the failure cell to **black `'0'`** everywhere. Today `MonthlyTables.tsx` uses `bg-black` but `DetailTable.tsx` uses `bg-status-red` — unify on a single token (`--cell-fail`) in both (and `CampaignsTableRow` tone map).

### 2.4 Platform color emphasis (operator-reported fix)
**Problem:** Meta/Google/TikTok colors disappear inside the colored store cards.
**Root cause (from code scan):** (a) the band slab + base tint (up to 85% top / 38% base) bleeds behind the small `PlatformBadge` dot; (b) `filter: saturate()` from freshness desaturation cascades to the dot.
**Treatment:**
- Each platform indicator gets a **vivid brand-color dot with a contrast ring** (white in light/dark) so it reads on any gradient.
- Give each CPM cell a subtle **per-platform tinted background** via the existing-but-unused `data-platform` hook.
- **Isolate the platform dot from the parent `saturate()`** (so brand identity survives on stale cards).
- Brand hues stay the brand-mirrored tokens: Meta blue, Google amber, TikTok pink/red.

### 2.5 Charts
Charts keep **real axes, gridlines, value/date labels, dashed target line, annotation pins, and tooltips** — only re-themed via tokens. (The mockup's hand-drawn placeholders are *not* the target; the production Recharts + the hand-rolled `RoasTargetChart` SVG stay structurally intact and re-skin through `--chart-*` vars.)

### 2.6 Mobile — full responsiveness (first-class requirement)
Every surface must be fully usable on phones: stacked grids, bottom/most-reachable nav, horizontally-scrollable dense tables, collapsed secondary toolbars, hidden-but-reachable search, and no clipped tooltips/popovers.

---

## 3. Per-tab application (what stays; how it re-skins)

All 7 surfaces keep their structure; the re-skin is the new palette/surfaces + the rules above.

1. **Home** (`PerStoreRow`, `CommandCenterHero`, `RoasTargetChart`, `ActivityFeed`, `InsightsBoard`): per-store + business-KPI band cards become mesh gradients; platform dots fixed; ROAS-vs-target chart re-themed (axes/pins kept).
2. **P&L** (`GoalTracker`, `PnLBreakdown`): GoalTracker stays a **neutral card with a status-colored progress bar + status chip** (the real component already works this way — the white-on-white seen in the mockup was a mockup-only artifact, now understood); it remains **GLOBAL** (ignores store/range filters). The "how much is left" waterfall = clean neutral ledger with green/red deltas + the 3 hero stat bars.
3. **Analysis**: **Trends** (multi-store ROAS line vs target, store hues) + **History = MonthlyTables** (year/month/store selectors, accordion per month, per-day rows, 4-band ROAS cell, black `'0'`). Verified in light + dark in the mockup.
4. **Campaigns** (+ **CampaignDrawer**): winners/watch card (green/red ROAS), reconciliation card, KPI strip, dense table with A/B/C/D health badges + per-row sparkline + 4-band ROAS cell. Drawer = 6 sub-tabs, health-score bars, campaign→adset→ad drill — re-skinned glass→neutral surface in light, elevated navy in dark.
5. **Products**: sales-by-product grouped-by-day table + products→campaigns pivot.
6. **Detail**: day×store rows, per-platform spend, 4-band ROAS cell + black `'0'`, green/red operating profit.
7. **Operator**: secret panel + Health/Sync/Activity/Danger sub-tabs + status/warning cards — token re-skin auto-applies; **mobile responsiveness added here (currently near-zero).**

---

## 4. Implementation approach (grounded in the codebase scan)

> Full file map lives in the 5 scan reports; the load-bearing seams are below. The detailed task breakdown belongs in the implementation plan (next step).

### 4.1 Reintroduce light + dark (mostly additive — the plumbing is intact)
The theme system was built dual-mode and only *switched off*. Reactivation:
- **Author a light token set** in `src/app/globals.css` — add a `[data-theme="light"]` block (or invert to `:root` = light default + `[data-theme="dark"]` overrides) re-declaring every `:root` token with light values. Because Tailwind aliases (`tailwind.config.ts`) and components already resolve through `var(--*)`, overriding the vars re-skins the whole app with **near-zero component edits**.
- **Un-pin the resolver:** `src/components/ThemeProvider.tsx:39` (`const resolved = 'dark'`) → restore `resolveTheme(choice, osPrefersDark)` (the function already exists, intact, in `src/lib/theme.ts`); restore the `matchMedia('(prefers-color-scheme)')` subscription; write `data-theme={resolved}` instead of the hardcoded value; delete the "re-assert dark" effect.
- **Un-hardcode** `src/app/layout.tsx:62` `data-theme="dark"` and make `viewport.themeColor` theme-aware.
- **Fix first-paint FOUC:** add a tiny pre-paint inline `<script>` in `<head>` that sets `data-theme` from `localStorage['roas-theme']` + OS preference before hydration (the standard next-themes pattern; the slot for this was deliberately removed and must return).
- **Toggle UX already exists** (Sidebar Sun/Moon/Monitor `Sidebar.tsx:192-232`; CommandPalette `theme-*` commands) and persists via `lib/theme.ts` — it lights up the moment the resolver is reactivated.
- **Default theme decision:** follow **system** (`prefers-color-scheme`), user-overridable + persisted. (Trivially changeable to a fixed default later.)

### 4.2 Token-driven color re-skin
- Re-skin = edit `:root` tokens (canvas, glass/surface, ink stack, `--band-*`, `--status-*`, `--chart-platform-*`, `--store-*`, accent, shadow/radius) + provide their light counterparts.
- **Tokenize the hardcoded-oklch blocks** (today they bypass the vars, so a theme flip won't reach them):
  - `.glass[data-band]` strong + muted gradient ladders (`globals.css` ~561–709) — **the single biggest surface**; refactor to consume `--band-*` (+ per-theme slab/halo opacities) or fork per theme.
  - `.fresh-chip.*`, `.cell.*` semantic-emphasis rules.
  - `CommandCenterHero` `BAND_STROKE` / `NEUTRAL_SPARK_STROKE` inline oklch (hero sparklines).
  - `RoasTargetChart` pin `textShadow` oklch.
- Replace the dark-only **body mesh wash** (`globals.css` ~229–263) with a light + dark variant.
- **Glass = white-alpha** today (works only over dark) → in light mode, swap the glass stack for opaque neutral surfaces.

### 4.3 Platform-color fix
- In `globals.css`, add rules keyed on the existing **`.cell[data-platform="meta|google|tiktok"]`** hook (rendered by `PerStoreRow.tsx:318-356`, currently unused in CSS): per-platform tinted cell background + a ring on the `PlatformBadge` dot.
- Make the badge **immune to the parent `filter: saturate()`** (e.g. lift it into an `isolation`/separate stacking context, or apply freshness desaturation to the value/label subtree only, not the platform cell).
- Keep `PlatformBadge.tsx` as the single platform-identity surface; brand hues from `--chart-platform-*`.

### 4.4 ROAS-band logic (unchanged) + cell-coloring consolidation
- Thresholds stay in `src/lib/format/useRoasBandGradient.ts` and `roasLabel()` in `src/lib/analytics.ts`. **No band logic moves.**
- Consolidate the **three** near-duplicate cell-coloring copies (`MonthlyTables.tsx`, `DetailTable.tsx`, `CampaignsTableRow.tsx`) and unify the failure-cell token (§2.3).

### 4.5 Mobile workstream
- Close the gaps found in the scan: make **`/operator`** responsive; let content columns re-expand on large desktops (`lg:`/`xl:`); fix the **known tooltip-clip bug** (`CampaignsTable.tsx:2444` TODO — needs Floating-UI/portal escape for column-header + HealthScoreBadge popovers); add breakpoints to `TabHeader` and the bare `ui` primitives where needed.
- Keep the existing good patterns (hand-rolled mobile sidebar drawer + scroll-lock, `overflow-auto` table wrappers, mobile filter collapse).

### 4.6 Guards to respect / update
- **ESLint** (all `error`): `no-hex-color-in-components`, `no-dark-variant-in-components` (light/dark must be **token-driven**, not `dark:` utilities), `no-physical-direction-in-components` (logical props only — RTL), the primitive-enforcement rules, `no-cross-palette-import`. Stay within token names or update the rules deliberately.
- **vitest token guards** (`glassTokens`, `chartTokens`, `colorCollisions`, `tokenSweep`): keep green; **add a new test** asserting every `:root` token has a light counterpart (no partial coverage).
- **Playwright visual CI is dark-only** (`playwright.config.ts` pins `colorScheme:'dark'`): add a **light** project and regenerate snapshots (light + dark) for `tests/visual/{pages,states}.spec.ts`.

---

## 5. Testing & verification
- Unit/DOM: keep all existing vitest green; add the token-completeness test (§4.6).
- Visual: Playwright light + dark snapshot projects.
- Manual: verify on the **production URL** (`roas-dashboard-smoky.vercel.app`) per the standing "no localhost in verify checks" rule — toggle light/dark, walk all 7 tabs + the drawer, confirm platform dots pop on every band + when stale, and check mobile at ≤520px.
- `tsc` + lint clean as pre-push gates; update User Manual (UX) + ARCHITECTURE (token/theming) per the "keep docs current" rule.

---

## 6. Risks
1. **Hardcoded-oklch tokenization** (band gradients especially) is the largest, most error-prone surface — band legibility must be re-tuned for a light canvas.
2. **FOUC** on first paint if the pre-hydration theme script is missed.
3. **Playwright snapshot churn** — every snapshot regenerates; review diffs carefully so real regressions aren't masked.
4. **Band gradient on light**: white text on light-tinted gradients needs contrast verification (WCAG) per band.
5. Scope creep into layout/feature changes — guard hard against it (re-skin only).

---

## 7. Open decisions (resolved here unless flagged)
- Default theme = **system**, overridable + persisted. ✅
- Failure cell = **black `'0'`** everywhere. ✅
- Mesh card = **rich multi-stop gradient**, strong on headline / muted on secondary. ✅
- Platform dot = **vivid brand color + contrast ring + per-platform cell tint**, desaturation-immune. ✅
- **To confirm with operator:** is the campaign drawer expected to be mocked before implementation, or is the token re-skin sufficient (it inherits the system automatically)? (Spec assumes the latter.)

---

## 8. Next step
On approval of this spec → invoke **writing-plans** to produce the phased implementation plan (waves: theming reactivation → token sets + gradient tokenization → platform-color fix → per-tab verification → mobile → tests/CI/docs), mapped to the files above.

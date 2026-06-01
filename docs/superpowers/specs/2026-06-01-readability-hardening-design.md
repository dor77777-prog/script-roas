# Design Spec — Readability & Legibility Hardening (text contrast · numeric overflow · chart-line legibility)

> **Status:** APPROVED-IN-PRINCIPLE (4 core decisions locked via brainstorming 2026-06-01). Awaiting user review of this written spec before `writing-plans`.
> **Date:** 2026-06-01
> **Scope:** Hebrew/RTL ROAS dashboard (`dashboard-web/`, Next.js + Tailwind, token-driven, light+dark, ROAS-band-tinted dynamic surfaces).
> **Origin:** 7-strand parallel audit + web-research workflow (`wf_68f2827b-ed1`, 8 agents / 162 tool uses). This is a **legibility-hardening** initiative — it does **not** change the locked mesh graphic language; it makes that language *guaranteed-readable* and *enforced in CI*.

> **Note on file:line references:** all `file:line` citations below are from the automated audit. Line numbers drift; every reference is re-confirmed by reading the file immediately before editing it (enforced by the Edit-requires-Read rule). Treat them as "this fact lives here," not "edit exactly this line."

---

## 1. Problem — State of play

The mesh re-skin shipped a coherent token system, but legibility on **dynamic surfaces** (ROAS-band gradients) and **unbounded numbers** rests on undocumented design-time assumptions, never on an enforced contract. Three faces of one gap:

### 1A. Contrast collisions (dynamic band surfaces)
- **Per-store metric values + CPM cells render white-on-near-white in LIGHT theme.** `globals.css:~1415–1420` forces `.sv` values + CPM cells to `oklch(100% 0 0)` white, and CPM cells get a `rgba(255,255,255,.16)` white-alpha background. In light theme the card base is `--glass-1 #ffffff` → white-on-white. Same pattern hits the **platform name** (`globals.css:~1426–1428`, white `!important`) and the **band-tag pill** (`globals.css:~1325–1338`, white text on `rgba(255,255,255,.22)`).
- **Bright off-white labels on pale light-theme bands.** `globals.css:~1061–1064` brightens `.sl`/`.hero-eyebrow` to `oklch(94% .012 80)` on all non-gray bands → pale-on-pale on the already-light orange/green bands.
- **No `--on-band-*` tokens exist.** Vivid-band text color is hardcoded white inline (`globals.css:~1092–1111`), legibility resting on a one-time measurement ("white at ≈35% down clears 4.5:1") that is **never regression-tested**.
- **ProductsTable text on a green→transparent gradient.** `ProductsTable.tsx:~577` (`from-status-greenBg to-transparent` + plain `text-ink`) and empty-state `:~636` (`text-ink-secondary` on `bg-status-greenBg`) — mid-gray on pale green, low contrast both themes.

### 1B. Numeric overflow / truncation (P0s)
- **Large-table money cells have NO width/overflow constraint.** `CampaignsTableRow.tsx:~409,412,430,612,675`; `ProductsTable.tsx:~699,715,719,737`; `ProductCentricView.tsx:~662–677`. A 7-digit value (`₪7,500,000` = 10+ chars) overflows or expands the column. **These are the P0s.**
- **`truncate` on full-precision numbers → mid-digit clip.** `PerStoreRow.tsx:~334` (AOV) and `:~368` (CPM) ellipsize a number if it leaves its safe range. Spend/revenue (`:~316,322`) are only safe because `fmtMoneyTextTight` pre-limits length — a fragile contract, not a guarantee.
- **Root mechanism gap:** fixed-px metric sizes (`globals.css:~1303 .sv{font-size:14px}`), no `clamp()`/`cqi`/`container-type`, and **no shared `<Money>`/`<Metric>` primitive** — formatting is scattered raw `toLocaleString('he-IL')` + hand-concatenated `$`/`CAD` (`CommandCenterHero.tsx:~202,214`, `GoalTracker.tsx`, `CampaignsTopList.tsx:~137`, `insights.ts`).

### 1C. Chart-line contrast
- **CommandCenterHero featured sparkline can vanish into a matching band.** `CommandCenterHero.tsx:~40–42,250+` + `Sparkline.tsx:~16–22`: featured card is `<Card band={businessBand}>` with an inline sparkline whose stroke is a semantic tone (`--up`/`--dn`/`--status-*`). `band="green"` + green sparkline = line fades into tint. **No halo/casing/scrim. P0.**
- **No sparkline has a protective outline anywhere** (`Sparkline.tsx`) → same collision on the ROAS-tile MiniSparkline. Recharts charts are safe only because they render on neutral `glass-1/glass-2` (`RoasTargetChart.tsx`, `RoasChart.tsx`, `MetaShopifyReconciliation.tsx`) — the scrim pattern already works there; it's our proof point.

---

## 2. Root cause

**Legibility on dynamic/unbounded content is asserted at design time but never guaranteed by a token contract or enforced in CI.**
- No guaranteed bg↔fg pairing for **band** surfaces (status palette has `-bg`/`-fg` pairs; bands don't).
- No overflow strategy (no width reservation, no fluid sizing, no compact floor, no single primitive).
- No chart-ink isolation on band cards (Recharts accidentally right; inline sparklines draw straight on the tint).
- Nothing is hermetic: `colorCollisions.test.ts` checks hue separation only; `guard-design-colors.ts` enforces token-only usage but **not contrast ratios**; Playwright dark-mode CI runs no per-band×theme contrast assertion.

---

## 3. Goals & non-goals

**Goals**
1. Every text element is ≥ WCAG AA (4.5:1 text / 3:1 large+graphical) against its **actual** background in **both** themes and **all** band states — guaranteed by tokens, not by eye.
2. No number is ever clipped/ellipsized; a value with 7+ digits is always fully legible (full value reachable always; on-screen value never broken mid-digit).
3. Every chart line/area/axis/crosshair is legible on any background it can sit on, in both themes.
4. All three guarantees are **hermetic** — enforced in CI so they cannot silently regress.

**Non-goals**
- No change to the locked mesh visual language (band hues, vivid hero look, V4 chart, slim sidebar, layout). We harden, we don't redesign.
- No new runtime dependency (CSS-first; no `fitty`/`react-textfit` unless a single truly-unbounded fixed-px cell survives — it won't).
- No information removal across tabs (per the "no info loss" rule). Reorganize/scrim, never delete.

---

## 4. Locked decisions (from brainstorming 2026-06-01)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Contrast standard | **WCAG 2.2 AA (4.5:1 / 3:1) as the hard CI gate** + **APCA Lc as advisory log** (non-blocking). |
| 2 | Big-number overflow | **CSS-first: `clamp()`/`cqi` fluid size → compact `₪1.2M` floor → full value in tooltip/`sr-only`.** Tables lean compact; hero/KPI lean full. Never `ellipsis` on a number. |
| 3 | Text on dynamic band | **Hybrid + unify both themes:** direct-on-band text uses a guaranteed `--on-band-*` token; chips/CPM cells sit on a neutral `--band-scrim` sub-surface. Same contract in light AND dark (incl. gray/“past-today” cards). |
| 4 | Chart lines on band cards | **Both `--plot-bg` neutral plot-scrim AND 1px casing/halo** on strokes. Micro-sparklines too small for a scrim fall back to background-aware single-neutral-ink luminance flip. |

**5th item (not separately asked — recommended default, confirm at review):** Freshness chip on vivid bands currently suppresses STALE↔red to white-alpha (`globals.css:~1260–1270`) to avoid green-LIVE-on-orange clash. **Default:** keep the white-alpha pill but re-introduce the freshness state as a **tokenized colored dot inside the pill**, so STALE=red semantics survive without the clash. ← *flagged for your yes/no.*

---

## 5. The systemic solution

Three dimensions, each one coherent token-driven mechanism, each CI-enforceable, all preserving the mesh language.

### 5A. Contrast — complete the M3 paired "on-color" matrix + scrim-the-gradient

Text **never** derives its color from the band; it references a paired token.

1. **Ship a complete `--on-band-*` matrix** (in `globals.css`, both `:root`=dark and `[data-theme="light"]`):
   - `--on-band-{red,orange,green,blue,gray}` + a `-muted` secondary tier each (10 + 10 per theme).
   - Authored with `oklch(from var(--band-*) …)` relative-color for ergonomics, but **values are statically verified ≥4.5:1**, not browser-computed (`color-contrast()` effectively unshipped; `contrast-color()` Safari-26-only and black/white-only — no mid-tone guarantee).
   - Replace every hardcoded `oklch(100% 0 0)` band text in `globals.css:~1092–1111, 1325–1342, 1415–1428, 1061–1064` with the paired `--on-band-*` var.
2. **Text on the GRADIENT (not a flat fill)** can't be covered by one pair across the luminance range → put it on a **controlled sub-surface**. Band-tag pill, freshness chip, and CPM cells become a token-driven **`--band-scrim`** (solid/high-opacity layer, theme-correct ink) so contrast is measured against the scrim, not the variable band. This matches the already-locked V4 signal (solid badge + chip). `text-shadow` halo stays a *minor enhancement only*, never the guarantee (axe can't credit it).
3. **Light-theme white-on-white fix is automatic** once CPM cells / platform names / band-tags use `--on-band-*` (resolves dark in light theme) instead of forced white. **Keep** the verified white-on-vivid **hero number**, but back it with the `--on-band-*` token (+ halo) instead of a raw literal.

### 5B. Overflow — one `<Money>`/`<Metric>` primitive

One shared primitive (`lib/format.ts` helpers + a small component) replaces scattered raw formatting. Layered, CSS-first:

1. **Format** via `Intl.NumberFormat` (`style:'currency'`, `currencyDisplay:'narrowSymbol'`) for the full value + a second `{notation:'compact', compactDisplay:'short', maximumFractionDigits:1}` formatter for the floor. Render inside `<bdi dir="ltr">` (pattern already at `CommandPalette.tsx:~364`) so `₪`/`CA$`/`±` never flip in RTL.
2. **Stability + reservation:** `font-variant-numeric: tabular-nums` (Heebo supports it) + `min-inline-size` in `ch` (logical → RTL-safe) sized to worst case (e.g. `11ch` for `₪9,999,999`) + `white-space: nowrap`.
3. **Fluid size, no media queries:** each metric card gets `container-type: inline-size`; number sizes via token `--metric-font: clamp(1rem, 0.75rem + 3cqi, 2.25rem)`. The **mandatory rem term** keeps WCAG 1.4.4 (200% zoom) safe; `cqi` lets the same component shrink in narrow columns and grow in wide ones. Replaces `globals.css:~1303 .sv{font-size:14px}` and PerStoreRow fixed sizes.
4. **Compact as a FLOOR only:** full grouped value while it fits the reserved `ch` at min font; switch to `₪1.2M` only when it would exceed. When abbreviated, expose the full value via `sr-only` span **and** `title` (sr-only for AT, title for mouse).
5. **Tables (the P0s):** give the unconstrained money cells the primitive + compact-floor / `max-w` so `₪7M` can never overflow.

### 5C. Chart-line legibility — neutral plot scrim + 1px casing, one canonical palette

Decouple series color from the band (Recharts already proves it works on neutral glass).

1. **Neutral inner "plot scrim" token** `--plot-bg` for any chart/sparkline on a band card (light = near-white ~92–96% over band; dark = elevated near-black ~85–92%). Lines/areas/**sparklines** render on this scrim, never on the raw tint. Band identity stays in the V4 frame (top bar + value-in-band-color + chip), not behind the data ink. → one canonical brand-mirrored, colorblind-verified palette (Meta-blue / Google-amber / TikTok-pink / Shopify-green) works on all 5 bands × both themes; no series×band×theme matrix.
2. **1px halo/casing on strokes** (`paint-order` / double-stroke), colored to the scrim — belt-and-suspenders for translucent scrims and crosshairs crossing same-hue lines. Fixes the `CommandCenterHero` + `Sparkline.tsx` P0. For micro-sparklines with no room for a scrim: **background-aware single-neutral-ink luminance flip** (near-black on pale bands, near-white on dark bands).
3. **Neutral chrome tokens** (gridline/axis/crosshair/tooltip) computed against the scrim, not the band; tooltips keep their elevated neutral surface. Gate data-bearing marks at **WCAG 1.4.11 (3:1)**.

---

## 6. New / changed tokens (single source of truth = `globals.css`)

Declared in **both** `:root` (dark) and `[data-theme="light"]`:
- `--on-band-{red,orange,green,blue,gray}` and `--on-band-{red,orange,green,blue,gray}-muted` — guaranteed-contrast foreground per band.
- `--band-scrim` (+ optional `--band-scrim-ink`) — neutral sub-surface for chips/CPM/freshness on band cards.
- `--plot-bg` — neutral chart plot scrim on band cards.
- `--metric-font` — `clamp(...)` fluid metric size; plus `--metric-min-ch` convention.
- Chart casing handled via `chart-*` tokens (no inline `var(--status-*)`/`var(--band-*)` in chart files — `local/no-cross-palette-import`).

All `.tsx` consume tokens only (the design-color guard fails CI on raw colors). White/white-alpha + raw values live exclusively in `globals.css`.

---

## 7. Component change map (the punch list)

| Area | Files (audit-cited) | Change |
|------|--------------------|--------|
| Band tokens | `globals.css` (~1055–1430) | Add `--on-band-*`, `--band-scrim`, `--plot-bg`; replace hardcoded white band text with tokens; fix `.sl`/`.hero-eyebrow` pale-on-pale |
| Per-store card | `PerStoreRow.tsx` (~316–368), `globals.css .store-card .sv/.sv-cpm/.sl` | `<Metric>` primitive; CPM/platform-name/band-tag → `--on-band-*` + `--band-scrim`; remove `truncate` on numbers |
| Hero | `CommandCenterHero.tsx` (~40–42,202,214,250+) | `<Money>`/`<Metric>`; sparkline → `--plot-bg` + casing; hero number → `--on-band-*` token |
| Sparkline primitive | `ui/Sparkline.tsx` (~16–22) | Add plot-scrim option + 1px casing / luminance-flip ink |
| Campaigns table | `CampaignsTableRow.tsx` (~409,412,430,612,675), `CampaignsTopList.tsx` (~137) | Money cells → `<Money>` + compact floor (P0) |
| Products | `ProductsTable.tsx` (~577,636,699,715,719,737), `ProductCentricView.tsx` (~662–677) | Money cells → `<Money>` (P0); fix green-gradient text contrast |
| Goal / insights | `GoalTracker.tsx`, `insights.ts` | Route through `<Money>`/format helpers |
| Format core | `lib/format.ts` (new helpers + `<Money>`/`<Metric>`) | The shared primitive |
| Freshness chip | `globals.css` (~1260–1270) | (pending #5 confirm) colored dot inside white-alpha pill |

---

## 8. Hermetic CI enforcement (the "close it shut" part)

1. **`guard-contrast.ts`** (extends `guard-design-colors.ts`): compute WCAG ratio of every `--on-band-*` pair vs its surface (and the gradient's worst-case sampled stop); **fail CI < 4.5:1** (text) / < 3:1 (large/graphical). Log APCA Lc as advisory.
2. **`@axe-core/playwright` `color-contrast`** assertions added to the existing dark-mode CI for **every tab in both themes** (axe reads solid backgrounds; gradients are covered by #1's static pair/scrim check — explicit division of labor).
3. **Overflow guard:** lint/unit rule failing if a money/metric renders outside `<Money>`/`<Metric>` (catch raw `toLocaleString`); Playwright assertion at **200% zoom** + a synthetic `9,999,999` fixture per metric cell asserting `scrollWidth <= clientWidth` (no overflow, no ellipsis).
4. **Chart band×theme snapshots:** extend the Playwright visual-snapshot gate to each **band × theme** combo so a future band-tint change can't silently kill chart legibility. Run the canonical palette through a CVD simulator once at adoption.

---

## 9. Testing strategy

- **Unit:** `format.ts` helpers (full vs compact thresholds, RTL `<bdi>`, currency narrowSymbol, 7-digit boundary, negative/zero). `guard-contrast` ratio math.
- **DOM/contract:** `<Money>`/`<Metric>` renders full when it fits, compact + `sr-only` full value when it doesn't, never `…` on a digit. Preserve all existing 313 DOM contract tests.
- **Playwright (both themes):** axe color-contrast per tab; 200%-zoom overflow per metric cell; band×theme chart snapshots.
- **Manual local pass (per "no drip-deploy"):** every tab, both themes, all band states (red/orange/green/blue/gray + freshness-faded), with a 7-digit fixture — before the single deploy.

---

## 10. Rollout

- Follow the **"no drip-deploy"** rule: audit-all → fix-all → verify every tab both themes **locally** (and `/dev/primitives` for data-empty local views) → **ONE deploy**.
- Commit directly to `main`, no branch (per operator convention); **push only when the user asks** (push = deploy; pre-push gate = tsc + vitest + lint + docs-currency + design-color guard + new contrast/overflow guards).
- Logical commit grouping within the single deploy: (1) tokens + guard-contrast, (2) `<Money>`/`<Metric>` primitive + table P0s, (3) band on-color/scrim migration, (4) chart plot-scrim + casing, (5) CI (axe + zoom + band×theme snapshots), (6) docs (User Manual + ARCHITECTURE).
- **Docs gate:** bump `docs/ROAS-Dashboard-User-Manual.md` (component changes) and update `ARCHITECTURE` (new token contract + guards) — both required by the docs-currency gate.

---

## 11. Open question for user review

1. **Freshness dot (#5 above)** — add the tokenized colored STALE dot inside the white-alpha pill on vivid cards? (default: yes.)
2. Anything in the locked mesh language that must stay byte-identical even if it's a borderline 4.3:1 (i.e., do we ever accept "operator-approved but slightly-under-AA" over the gate)? (default: no — gate wins; we re-tune the token until it passes while staying as close to the mockup as possible.)

---

*Audit source:* workflow `wf_68f2827b-ed1` (7 strands: tokens / dynamic-surfaces / overflow / chart-lines + contrast / overflow / chart-contrast research). Raw brief retained in session task output `wbmgdva35`.

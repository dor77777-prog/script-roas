# Refined Dashboard Design Dossier — RTL ROAS Analytics

**Date:** 2026-06-22
**Status:** Curated design direction, grounded in real 21st.dev harvested components
**Why this exists:** Two prior mockup rounds were rejected as *מצועצע* (gaudy / over-decorated). This dossier codifies a **Linear / Stripe / Vercel-grade RESTRAINED** aesthetic for the RTL Hebrew ROAS dashboard. Every recipe below cites the specific harvested 21st.dev reference it derives from. The operator-locked ROAS band colors are KEPT, but treated as the *only* strong color moments — applied tastefully, never slathered.

---

## 0. North Star

> **Neutral-led surfaces. ONE accent (violet). Strong color reserved exclusively for ROAS band signal. Hierarchy from type scale + whitespace, not from decoration. Elevation from hairline borders + a whisper of shadow — never glows, halos, gradients, or blobs.**

The premium signal in this aesthetic is **negative space and restraint**, not visual "pop." If a surface needs decoration to feel finished, the layout is wrong.

---

## 1. Palette Discipline

### 1.1 Surface system (neutral-led)
- **Page canvas:** existing navy/neutral token (`--surface-app`). Flat. No gradient, no mesh, no dot-grid-as-decoration on the page itself.
- **Card / panel:** single `--surface-card` token, `rounded-2xl` (or `rounded-xl` for dense tables), **one** hairline border, **one** very subtle shadow (`shadow-sm` max). Reference: *"Financial Dashboard"* — flat single-surface card, `bg-card rounded-2xl border shadow-sm`, "panel not component soup."
- **Sunken / inset wells** (filter rails, search fields, pill tracks): canonical `bg-pill-track` (`--surface-sunken`) per the locked inset-well token rule. Always-visible affordance.
- **Elevation:** prefer `ring-1 ring-[border]` at low opacity on dark surfaces — reads as a precise edge without shadow blur. Reference: *"KPI Card"* — `ring-1 ring-zinc-800` instead of box-shadow.

### 1.2 The ONE accent: violet
- Violet (`--accent` / `var(--color-violet-500)`) is the **single** brand accent. It appears on at most **one element per card**: an active nav indicator, a selected metric tab, the active chart series, a positive-delta badge tint, a focus ring, a sort-active chevron.
- **Never** as a card background. **Never** paired with a second hue. Reference: *"Line Charts 6"* — single `var(--color-violet-500)` for the *selected* series only; all other series colors exist but are never active simultaneously.

### 1.3 ROAS band colors — KEPT, applied tastefully
The operator-locked bands stay exactly as defined:
- **red** < 2x · **orange** 2–2.7x (`#EF9331` + white, locked sub-AA exception) · **green** 2.7–3x · **blue** > 3x · **gray** (no-data) · **red-alarm** (critical). **White-on-band** text, both themes (locked).

**Discipline for using them:**
- Band color is the **only** place strong saturated color is allowed, and it must carry **information** (a store's/business's current ROAS health). Reference rejection: *"Statistics Card 2"* / *"Statistics Card 15"* — vivid fuchsia/teal/blue card backgrounds with decorative SVG blobs are the canonical anti-pattern. Color must mean ROAS, never "this is card #3."
- **Where bands live:** the business hero surface and per-store cards (ROAS-state gradient tint per the locked rule), and as the *fill of band pills/chips* in tables and headers. NOT on KPI tiles, NOT on chart chrome, NOT on the sidebar.
- **On-band contrast guarantee:** white-on-band foreground token (Material-3 style), never text-color-derived-from-band. Honor existing readability guards.

---

## 2. Type Scale — real hierarchy, NO oversized display numerals

Modular scale, tuned for density and calm. **The headline rule: no `text-4xl`+ hero numerals, no `font-black`.**

| Role | Size | Weight | Tracking | Notes |
|---|---|---|---|---|
| Page title | `text-xl` | `font-normal` | normal | Stripe-style: headline + muted inline continuation in one element. Ref: *"Combined Featured Section"* — `text-xl font-normal` + `text-gray-500` continuation. |
| Section header | `text-sm` | `font-semibold` | normal | Structure via spacing, not dividers. Ref: *"Financial Dashboard"*. |
| KPI / hero value | `text-2xl` (compact: `text-xl`) | `font-medium` / `font-semibold` | `tracking-tight` | **Medium not bold.** `tabular-nums`. Ref: *"Statistics Card 1"* — `text-2xl font-medium tracking-tight` reads Stripe/Linear; bold reads cheap. |
| Metric label | `text-sm` | `font-medium` | normal | `text-muted-foreground`, deliberately de-emphasized. Ref: *"Statistics Card 1"*. |
| Delta / comparison | `text-xs` | `font-medium` | normal | comparison value `text-foreground`, label muted. |
| Eyebrow / taxonomy | `text-xs` | `font-medium` | `uppercase tracking-wide` | Section group labels only. Ref: *"Dashboard with Collapsible Sidebar"*. **Cap tracking at `tracking-wide`** — `tracking-[0.5em]` reads as marketing (rejected). |
| Nav label | `text-sm` (14px) | `font-medium` | normal | Max **2** type sizes in nav. Ref: *"Sidebar Component"* (Lexend, 14px). |

**Numerals everywhere:** `tabular-nums` + route through the shared `<Money>`/`<Metric>` primitive (compact-floor, nowrap, exact value in `title`). Chart tooltips use `font-mono tabular-nums`. Ref: *"Dotted Line Chart"*, *"Line Charts 6"*.

---

## 3. Spacing & Whitespace — calm and generous

- **Grid rhythm:** `gap-6` for KPI/hero grids, `gap-4` for dense secondary grids. Consistent across the entire app. Ref: *"Statistics Card 2"* layout skeleton (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6`).
- **Card internal padding:** `p-5`–`p-6`. Generous but not loose.
- **Nav rows:** rigid `h-11` row height with a `w-12` icon column — icons/labels optically aligned across collapsed/expanded. Ref: *"Dashboard with Collapsible Sidebar"*.
- **Table cells:** compact-but-breathing `px-2 py-2.5`, headers `h-10`. Dense without cramped. Ref: *"Table"* (Vercel/Linear primitive).
- **Section separation via spacing, not rules** wherever possible; when a divider is needed it is a single hairline `border-t` with no decoration. Ref: *"Financial Dashboard"* (headers via spacing alone).
- **Mobile-first:** design the small-screen stack first, scale up. Whitespace is the premium signal — do not fill it.

---

## 4. Elevation — hairline borders + whisper shadow ONLY

- Default card: **hairline border** (`border` / `ring-1 ring-border`), at most `shadow-sm`.
- Hover lift: a **single step** — `hover:shadow-md` OR `scale-[1.02]` max, never both, never `scale-1.05`. Ref: *"Financial Dashboard"* (`whileHover` barely-there lift); *"Statistics Card 2"* rejection notes `scale-1.05` is too bouncy.
- **Borderless-grid trick** for a row of hero metrics: render cards `border-0 shadow-none` inside ONE parent that carries a single `border rounded-xl` — reads as a cohesive data panel, not N scattered widgets. Ref: *"Statistics Card 7"*, *"Table"* (shared-edge cells).
- **NO** glow filters as decoration, **NO** halos, **NO** `shadow-2xl`, **NO** neumorphic extruded shadows (`DashboardTemplateNeumorphism` — hard reject), **NO** inner-glow gradients.

---

## 5. Named Component Recipes

### 5.1 App shell + sidebar nav
**Primary ref: *"Dashboard with Collapsible Sidebar"*** (single-rail, Linear-tier). Optional dual-rail upgrade from *"Sidebar Component"* (Frame760 / Carbon + Lexend) if a contextual second panel is wanted.

- Sticky full-height sidebar, `shrink-0`, **flat** background (no gradient — `Sidebar`/slate-gradient variant is hard-rejected), single `border-r` hairline as the only boundary.
- **Active item = left-accent stripe** `border-l-2 border-[violet]` + ghost `bg-[violet]/8` wash. NOT a filled pill, NOT a shadow blob. The stripe IS the signal. (Frame760's pure `bg-neutral-800` neutral-elevation active state is the even-more-austere alternative — acceptable.)
- Section group headers: `text-xs font-medium uppercase tracking-wide text-muted-foreground`, hidden when collapsed.
- Collapse toggle: plain icon button, no floating pill.
- Header: minimal — page title + theme toggle. Optional ⌘K search (ref *"Financial Dashboard"*: left-icon + right-kbd badge, `focus:ring-2 focus:ring-ring`). Lots of negative space.
- **AVOID:** gradient sidebar surface, gradient active fills, colored notification dot badges as ambient decoration, `shadow-2xl`, `rounded-l-2xl` on a full-app shell (use plain `border-r`).

### 5.2 Page header
- One-line Stripe-style: `text-xl font-normal` title + `text-muted-foreground` inline continuation clause. Right-aligned action cluster kept minimal. Ref: *"Combined Featured Section"*. (RTL: title leads from the right; actions on the left.)

### 5.3 KPI / stat cards
**Primary ref: *"Statistics Card 1"*** (the cleanest Linear/Stripe example).
Anatomy (three-tier rhythm):
1. `text-sm font-medium text-muted-foreground` label (small, de-emphasized).
2. Value + delta on one flex row: `text-2xl font-medium tracking-tight tabular-nums` value beside an outlined **delta badge** (`Badge` `success`/`destructive`, `appearance="light"`, inline `ArrowUp`/`ArrowDown`). The badge's tint is the only color.
3. Hairline `border-t pt-2.5 text-xs text-muted-foreground` comparison row ("vs last month: **value**" — value `font-medium text-foreground`). **This hairline comparison row is the standout micro-detail to carry through.**
- Optional kebab overflow (`MoreHorizontal`, `variant="dim"` — invisible until hover): pin / alert / share / remove. Ref: *"Statistics Card 1"*, *"Statistics Card 2"* toolbar.
- Compact baseline accent: a `h-0.5 w-16 rounded bg-current/40` bar is acceptable (ref *"KPI Card"*) — at most one per card.
- **AVOID:** colored card backgrounds, per-card arbitrary hue, decorative corner circles (`absolute -right-6 -top-6 rounded-full`), `shadow-lg`, full-bleed icon at 60% opacity, CTA footer bars (*"Statistics Card 15"* — hard reject), `font-bold`/`font-black` values.

### 5.4 Business hero / overview
- The **one** place ROAS band color leads: hero surface carries the ROAS-state gradient tint (locked rule), white-on-band text. Per-store cards likewise band-tinted with freshness desaturation (locked 3-stage rule).
- Hero metrics rendered as a **borderless shared-edge panel** (§4) so it reads as one cohesive overview, not scattered tiles. Three-tier rhythm per §5.3.
- Keep numerals restrained: `text-2xl`–`text-3xl` max even here; **no giant display numerals**. Ref: *"Metric Overview"* digest takeaway (`text-3xl font-semibold tabular-nums`, accent on one element per card max).
- **AVOID:** the hero becoming a gradient showpiece. Band tint = information, not a wallpaper. No SVG blobs, no floating geometry, no pixel-bursts (*"A Modern Hero Section"* — hard reject).

### 5.5 Charts
**Primary refs: *"Line Charts 6"*** (composition + metric-tab UX) and ***"Dotted Line Chart"*** (axis/grid restraint).
- **Metric-tab-above-one-canvas:** KPI pills sit above a single shared chart; clicking one swaps the active series. Eliminates legend + multiple charts. Each tab = label / value / delta / "vs period". Ref: *"Line Charts 6"*.
- **Axes stripped:** `axisLine={false}`, `tickLine={false}`, `tickCount={6}`, 11px `text-muted-foreground` labels. Ref: both.
- **Grid:** horizontal-only (`vertical={false}`), `stroke-border/50` (a whisper). `cursor={false}` on tooltip — no crosshair clutter. Ref: *"Dotted Line Chart"*.
- **Line:** single token-driven color (`var(--chart-1)`/violet for active), `strokeWidth={2}`, `dot={false}` (or `strokeDasharray="4 4"` for a calm trend read). Active dot: white stroke ring (r=6). Ref: both.
- **Tooltip:** `rounded-lg border-border/50 bg-background`, `font-mono tabular-nums` value, `shadow-sm`. No color blobs. Ref: both.
- **Single-hue ramps, not rainbows:** if multiple series must coexist, use opacity/lightness steps of ONE violet, never categorical multi-hue. Ref: *"Bar Chart"* (Subframe single-hue ramp idea); *"Highlighted Bar Chart"* hover-dim focus (non-active bars → `fillOpacity 0.3`).
- **Chart ink legibility:** series color stays legible on any band-tinted surface it can sit on — draw on a neutral plot scrim / add casing per the readability rules.
- **AVOID:** the per-line colored **glow/drop-shadow filter** (`feDropShadow` stdDeviation 25) from *"Line Charts 6"* — it is the one over-decorated detail there; **skip it** (glows are on the AVOID list). Also: HUD frames, corner-cut clip-paths, dot-grid-as-decoration backgrounds, gradient fills >2 stops, hardcoded hex series colors (*"HUD Area Chart"*, *"Area Chart"*, *"Horizontal Bar Medium"* — hard reject), reaviz multi-layer box-shadow + bar glow, Framer stagger on data rows, mid-word axis truncation.

### 5.6 Data tables
**Primary ref: *"Table"*** (Vercel/Linear compound primitive) + mechanics from *"Basic Data Table"*.
- Compound API (`Table.Header/Body/Footer/Row/Head/Cell`); column widths via `<Table.Col>` colgroup, not per-cell.
- **Single hairline system:** `border-b` on thead, `border-t` on tfoot. **No vertical column dividers, no per-cell box shadow, no card chrome.** The surface breathes.
- Cells `px-2 py-2.5`, headers `h-10`. Footer totals row `font-medium text-foreground` (higher hierarchy via weight, not color).
- Zebra via `nth-child` arbitrary selector only. Sort chevrons: active `text-[violet]`, inactive `text-muted-foreground/40`. Skeleton: `animate-pulse bg-muted` at exact row heights (no layout shift). Long lists: virtualize with gradient fade + "show more". Ref: *"Table"*, *"Basic Data Table"*.
- ROAS band shown as a **pill in-cell** (§5.7), never as a full-row background.
- **AVOID:** `rounded-2xl` table wrappers (soft/consumer-tier — use `rounded-xl`/`rounded-lg`), hardcoded hex in classNames, emoji empty states, per-column filter inputs in `<th>`, progress bars in `<th>` headers (*"InlineAnalyticsTable"* — reject), demo caption below table.

### 5.7 Badges / pills (incl. ROAS band + status)
**Primary ref: *"StatusBadge"*** (`color/10` fill + `color/20` border + full-saturation text).
- **Status badges** (live / synced / error): `bg-[hue]/10 text-[hue] border-[hue]/20` — near-transparent wash + ghost border on dark navy. Geometry tight: `h-5 px-2 text-xs`, icon `h-3 w-3` `gap-1` `aria-hidden`. `font-medium` (never `font-semibold` at small size — reads stamped). Hover is the only animation (`hover:bg-[hue]/20`). Accessibility: `role="alert"`/`aria-live` for destructive, `role="status"` otherwise. Ref: *"StatusBadge"*.
- **Live/real-time:** the `animate-ping` dot (`h-2 w-2`, solid inner) communicates "live now" with no label. Ref: *"Status"* (Vercel-status-page tier).
- **ROAS band pill** is the deliberate exception: solid band fill + white-on-band text (locked). This is the one place a saturated fill is correct, because it encodes ROAS health.
- **Delta badge** (in KPI cards): outlined `appearance="light"`, single accent token, `ArrowUp`/`ArrowDown`. Ref: *"Line Charts 6"*, *"Statistics Card 1"*.
- **AVOID:** light pastel fills (`bg-orange-50`) that invert badly on dark, fixed widths, `rounded-xl` on data labels, `font-semibold`/`strokeWidth=3` icons, fully-opaque status fills, broad `uppercase tracking-wider` (*"Status Badge"* hardcoded-hex variant — hard reject).

### 5.8 Drawers / sheets
- Use the Radix Sheet primitive. Any modal opened OVER a sheet must be a **nested Radix dialog** (a hand-rolled fixed-overlay div is inert over a Sheet — locked incident note). Flat surface, hairline edge, `shadow-sm`. Same type/spacing system as cards. No decorative chrome.

### 5.9 Bento / overview grid (if used)
**Ref: *"Bento Monochrome 1"*** — token-driven palette object, `auto-rows-[minmax(120px,auto)]` + asymmetric `col-span`, hairline `border-white/10`, elevation only on hover. Section header via `border-b`, capsule meta-tags `tracking-[0.2em]` max.
- **AVOID:** per-card radial-gradient washes/tints, full-bleed image panels, `backdrop-blur` glass, ambient inner purple glow (`box-shadow inset`), animated icons in every cell (motion = hover-only), `tracking-[0.5em]` pills, `text-2xl` marketing headlines in card bodies (*"Bento"* lowest-restraint variant — reject).

---

## 6. EXPLICIT AVOID LIST — exactly what made prior mockups gaudy

1. **Gradient-as-hero** — no gradient/mesh wallpaper as the main visual. The ROAS band tint is the *only* gradient, and it encodes information.
2. **Giant display numerals** — no `text-4xl`+ values, no `font-black`/`font-bold` on metrics. Cap at `text-2xl`–`text-3xl`, `font-medium`/`font-semibold`, `tracking-tight`, `tabular-nums`.
3. **Decorative gauges / arcs / dials / funnels** — no radial gauges, progress arcs, funnel shapes (*"Funnel Chart Big"* reject).
4. **Glows / halos** — no `feDropShadow` line glows, no neon, no `ring` glow blooms, no `box-shadow inset` ambient color, no `shadow-2xl`. Even the otherwise-great *"Line Charts 6"* glow filter is skipped.
5. **SVG blobs / corner geometry / pixel-bursts** — no blurred ellipses, circles, polygons, dotted world-maps, or `Math.random()` pixel art on cards (*"Statistics Card 2/15"*, *"A Modern Hero Section"* rejects).
6. **More than one accent color** — violet is the sole accent. No fuchsia/teal/blue/cyan multi-hue. Categorical series → single-hue opacity ramp. Strong color = ROAS band only.
7. **Per-card vivid backgrounds** — KPI/stat/chart cards use the neutral surface token. Vivid fill is reserved for ROAS band hero/store cards and band pills.
8. **Heavy shadows / neumorphism** — no extruded `box-shadow` pairs, no `shadow-lg`+ on cards, no inset-pressed states. Hairline border + `shadow-sm` max.
9. **Ornamental flourishes** — no animated icons in every cell, no Framer spring on data values (numbers snap or tween linearly), no stagger-on-every-row, no emoji in nav/empty states, no over-tracked marketing pills (`tracking-[0.5em]`), no `rounded-2xl`/`rounded-3xl` consumer-soft chrome on data surfaces.
10. **HUD / sci-fi framing** — no corner-cut clip-paths, frame-border SVGs, dot-grid decoration backgrounds (*"HUD Area Chart"* reject).

---

## 7. Hermetic guardrails (carry forward)
New UI must pass existing readability guards, not bypass them: WCAG-AA contrast both themes (on-band/scrim tokens, never text-color-from-band), `<Money>`/`<Metric>` overflow-safe numerals, no native `title=` (use `HelpTooltip`), no info loss across tabs (STAYS/MOVES/NEW labels only). Where practical, extend CI guards (contrast ratio, token-only ratchet, overflow assertion, band×theme snapshot) so this restraint can't silently regress.

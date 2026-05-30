# Figma Deep Research — Premium Dashboard Inspiration

> Research conducted 2026-05-31 for the ROAS dashboard UI/UX overhaul. Goal: surface concrete patterns from the world's best contemporary dashboards (Figma community files, Dribbble shots, Mobbin captures, and shipped products such as Linear/Vercel/Notion/shadcn) that map cleanly onto our Hebrew-RTL, multi-store, multi-platform ad-spend context.

---

## Method note

**Direct Figma access blocked.** `figma.com/community/file/<id>` consistently returns HTTP 403 to unauthenticated fetches — Figma gates community files behind a login wall even for the public preview pane. WebSearch confirms the two user-referenced files exist:

- **File A — Vision UI Dashboard React (MUI)** — id `1060952013207459371`. Listing: <https://www.figma.com/community/file/1060952013207459371/vision-ui-dashboard-react-mui-dashboard-free-version>
- **File B — SaaS Selling Dashboard / Admin Dashboard** — id `1140272887408902677`. Listing: <https://www.figma.com/community/file/1140272887408902677/saas-selling-dashboard-admin-dashboard>

I therefore reconstructed each file's design language from:

1. The **shipped reference implementation** (Creative Tim's hosted Vision UI React demo + GitHub repo for File A).
2. **Designer body-of-work** (Tran Mau Tri Tam's Dribbble shots for "Core" / "Unity" / "Interface Dashboard v2" — File B sits stylistically inside that family).
3. **Third-party showcase aggregators** (UI4Free, Speckyboy, Setproduct, Fountn.design).

For the broader curation I pulled directly from sources that allow scraping (Linear, Vercel, Notion design-MD benchmarks, Shopify Polaris, Tailwind Catalyst, shadcn/ui examples, Cloudscape, Smashing Magazine, Tabular Editor, Triple Whale's own blog). Mobbin and Awwwards detail pages returned 403; their search/index pages were partially scrapable but did not yield per-screen specifics.

**Coverage assessment:** 2 specific Figma files (indirect characterisation only) + ~14 distinct dashboard design references (direct or near-direct). Sufficient to triangulate the patterns that recur across "premium 2026" dashboard work.

---

## File 1: Vision UI Dashboard (React MUI) — id `1060952013207459371`

**Sources of preview**

- Creative Tim product page — <https://www.creative-tim.com/product/vision-ui-dashboard-react>
- UI4Free third-party listing — <https://ui4free.com/uikit/figma-vision-ui-dashboard-react-mui-dashboard.htm>
- GitHub repo (shipped React implementation) — <https://github.com/creativetimofficial/vision-ui-dashboard-react>
- AppSeed Medium write-up — <https://medium.com/@appseed.us/vision-ui-dashboard-premium-mui-template-9112eb8a834b>
- Admin-dashboards review — <https://www.admin-dashboards.com/vision-ui-dashboard-pro-mui-template-s8x1/>

**Aesthetic characterisation**

Vision UI is the **flagship "dark gradient hero" Material-UI dashboard**. Color identity is a near-black canvas (deep navy / `#0F1535`-range) flooded with **purple→blue→pink mesh gradients** behind hero KPI cards. Charts are rendered via ApexCharts with **glowing line strokes** (typically violet `#582CFF` and pink `#FF0080`), often on a transparent card with a faint inner shadow. The vibe is **"crypto-bro 2021 with Material-UI bones"** — visually expensive, deliberately futuristic, low information density. Seven sample pages cover Dashboard / CRM / VR (yes, VR) / Smart Home / Profile / Sign-in / Tables. Sidebar is a fixed ~250 px dark gutter with a glassmorphic active-item pill.

**5–8 patterns worth adapting to our ROAS context**

1. **Hero KPI row with a small inline sparkline + gradient stroke.** Vision uses 4 cards across the top (Today's Money / Today's Users / Ads Views / Sales). Each card pairs a 28-32px number with a tiny chart. We already use this pattern — Vision UI confirms 4 hero cards is the sweet spot for 1280-1440px screens.
2. **Gradient delta chip instead of plain `+12%` text.** Vision wraps the delta in a small pill with subtle gradient outline. For ROAS, we can keep the chip but ditch the gradient — semantic green/red carries the same weight at lower visual cost.
3. **Card titles in muted small-caps above the number.** Their hierarchy is `LABEL` (11px, gray, uppercase, +0.5 tracking) → big number → delta chip. Excellent glanceability discipline.
4. **Charts breathe inside the card** — no chart axis label clutter, no chart title (the card title is the chart title). We can adopt this for our daily revenue/spend chart.
5. **Sidebar grouping by capital-letter section headers** (`ACCOUNT PAGES`, `DASHBOARDS`, etc.). Cleaner than our current sidebar which has un-grouped items.
6. **Dark canvas with elevated cards** — Vision uses Background `#0F1535` and Card `#0F1535` with `rgba(255,255,255,0.05)` inner border. This is the "elevation by border, not by shadow" trick that works much better in dark mode than drop shadows.
7. **Mini segmented control on charts** for `Day / Week / Month` toggle, top-right inside the card. Translates directly to our `7d / 30d / 90d` range filter at the chart level.

**2–3 patterns to avoid**

- **The mesh gradient hero behind KPIs.** Looks beautiful in a screenshot, dies the first time you put a Hebrew number on top because the contrast varies across the gradient. Hebrew RTL especially exposes this because the eye starts on the right where the gradient is often dimmer.
- **Glowing chart strokes.** Adds visual noise without information. Stripe / Vercel / Linear all use 1.5-2px flat strokes.
- **VR / Smart Home cosplay pages.** Skeuomorphic decoration that has no place in a real ops tool.

---

## File 2: SaaS Selling Dashboard / Admin Dashboard — id `1140272887408902677`

**Sources of preview**

- Figma listing (403 to fetch, but verified via WebSearch) — <https://www.figma.com/community/file/1140272887408902677/saas-selling-dashboard-admin-dashboard>
- Designer profile + body of work (same family) — <https://www.figma.com/@tranmautritam>, <https://dribbble.com/tranmautritam>
- Core Dashboard Builder (sister product) — <https://dribbble.com/shots/25782776-Core-2-0-Dashboard-Builder>, <https://dribbble.com/shots/16958016-Core-Dashboard-Builder-Home-light-dark>, <https://dribbble.com/shots/16858056-Core-Dashboard-Builder-Dark-Components>
- Unity Dashboard (campaign-tracker, very close cousin) — <https://dribbble.com/shots/14356166-Unity-Dashboard-Campaigns>
- Interface Dashboard v2 — <https://dribbble.com/shots/10752883-Interface-Dashboard-v2>
- Designer's Fountn portfolio — <https://fountn.design/resource/tran-mau-tri-tam-premium-ui-kits-3d-design-assets/>

**Aesthetic characterisation**

Tran Mau Tri Tam's entire admin/dashboard catalogue shares a **calm, clean, slightly desaturated light aesthetic** with optional matched-pair dark mode. Color identity: off-white canvas (`#F7F8FB`-ish) with **soft pastel accent strokes** (mint green `~#34D399`, soft orange `~#FB923C`, lavender `~#A78BFA`). Density is **medium-high** — Tran's signature is fitting 5-7 useful panels on a 1440 viewport without feeling crammed, by leaning on tight 12-16px card padding and 1px hairline borders instead of shadows. Typography is Inter or SF Pro at 13-14px body. Sidebar is a slim ~64-72px collapsed icon-only rail that expands to ~240px with labels. The "SaaS Selling" file specifically focuses on **sales pipeline + revenue performance**, with deal-funnel visualisations and tabular leaderboards.

**5–8 patterns worth adapting to our ROAS context**

1. **Collapsible icon rail by default.** Saves ~180px of horizontal space — significant for our RTL layout where right-side panels (filters, scope) get squeezed.
2. **Hairline borders, no drop shadows.** `1px solid rgba(0,0,0,0.06)` on light mode, `1px solid rgba(255,255,255,0.08)` on dark. Cleaner at high pixel density than our current subtle-shadow approach.
3. **Pastel accent palette over saturated brand colors.** Mint/lavender/peach reads as "premium SaaS" while saturated red/blue/green reads as "bootstrap admin." Apply to chart series colors for Meta/Google/TikTok.
4. **Persistent revenue/spend dual-axis chart hero.** Tran uses split-axis line+area to compare two related series — exactly the shape we need for revenue vs spend.
5. **Tabular leaderboards with inline trend bar.** Each row shows a tiny horizontal bar of relative magnitude next to the number — instant ranking. Maps to our Campaigns table.
6. **Empty state = friendly illustration + one-sentence diagnosis + one CTA.** Not "No data." but "No campaigns spent yesterday. [Connect a new ad account]."
7. **Tab bar with active underline (2px) and 14px medium weight.** Lighter than our current pill-style tabs.
8. **Status pills (`Active`, `Paused`, `Archived`) with low-saturation backgrounds** (e.g., green `#10B981` text on `#ECFDF5` background) instead of solid filled pills.

**2–3 patterns to avoid**

- **Overuse of pastel hairlines on dark mode.** They disappear under 1080p TN panels. Always pair with a slightly elevated card background, not just a border.
- **Designer's signature 3D illustrations in empty states.** Beautiful but heavy (>200KB PNGs) and stylistically loud. Use Heroicons-style line illustrations or none.
- **5-6 chart series per chart.** Tran's marketing screenshots cram series to look impressive; in production this creates "rainbow heatmap of sadness." Cap at 3-4 series for our 3-platform context (Meta/Google/TikTok + a Total line if needed).

---

## Broader Figma / dashboard curation findings

Grouped by aesthetic direction.

### A. Minimal / monochrome / "Linear-Vercel" family

**1. Linear (shipped product)** — <https://linear.app/now/how-we-redesigned-the-linear-ui>, design-system extraction at <https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1>

- Pitch-Black canvas `#08090A`, Graphite cards `#0F1011`, Charcoal borders `#23252A`. Single vivid accent: Neon Lime `#E4F222`.
- Inter Variable; 4px base unit; 6px radius on cards/buttons.
- Migrated to LCH color space (perceptual uniformity across hues). Worth doing for ours if we ever introduce theming.

**2. Vercel Geist** — <https://vercel.com/geist/typography>, <https://vercel.com/geist/colors>, breakdown at <https://seedflip.co/blog/vercel-design-system>

- Pure `#000000` / `#FFFFFF` plus 10-step gray ramp.
- Geist Sans + Geist Mono; tabular numerics on by default.
- 8px grid; 0/4/6/8/9999px radius scale. No drop shadows — depth is communicated only by background tone and 8%-opacity white borders.

**3. shadcn/ui dashboard-01 example** — <https://ui.shadcn.com/examples/dashboard>

- Two-column layout: ~256px sidebar + flex content.
- KPI cards in 4-up grid with title / number / delta / one-line context description (e.g., "Trending up this month").
- One hero line chart with three preset range chips (`3m / 30d / 7d`).
- Dense data table beneath with bulk-select, type chip, status chip, action menu — the new shadcn `DataTable` pattern.

### B. Polychrome but disciplined — "Stripe / Polaris" family

**4. Shopify Polaris data-viz** — <https://polaris-react.shopify.com/design/data-visualizations>

- Single-series default = purple; comparison-to-past = purple (current) + gray (past).
- Multi-series capped at 4 lines, must include legend.
- Bar width = ~2× the gap between bars.
- Bias palette = green positive / red negative.
- Money abbreviated: `$1.0k`, `$1.0b`.
- Every chart must ship with an accessible data-table fallback.

**5. Notion** — <https://designmd.cc/benchmarks/notion>

- High-contrast B/W foundation with a single functional blue `#097FE8` for CTAs.
- NotionInter (Inter variant); weight scale 400/500/600 only.
- 4px base; 8/12px radii.
- Approachable hand-drawn icons as a humanising layer.

**6. Stripe Dashboard (referenced via Dribbble + style guides; redesign documented at <https://mattstromawn.com/projects/stripe-dashboard/>)**

- "Boring on purpose" — uses Stripe's purple `#635BFF` exclusively as the accent.
- Charts: thin 1.5px line strokes, soft 8% fill under the line, gridlines at 6% opacity.
- Tables dominate (Stripe's data is row-shaped); KPIs are 2nd-class.

### C. Dense data tables — "Linear/Vercel-table" family

**7. Vercel/Next.js admin template** — <https://vercel.com/templates/next.js/next-js-and-shadcn-ui-admin-dashboard>

- Variable content widths via a "container size" toggle.
- Theme presets that swap accent colour without touching the layout.

**8. Untitled UI React (Jordan Hughes)** — <https://www.untitledui.com/blog/react-dashboards>, sample at <https://dribbble.com/shots/20082626-Analytics-dashboard-Untitled-UI>

- Neutral aesthetic; mid-density. Highly polished sidebar with section dividers.
- Uses RAC (React Aria Components) + Tailwind. Sidebar uses subtle 1px section dividers, not headings.

**9. Catalyst (Tailwind UI)** — <https://catalyst.tailwindui.com/docs/sidebar-layout>

- Zinc-based neutral palette; purple-500 single accent.
- Sidebar Body/Header/Footer pattern with `SidebarSection` grouping — adopted in many recent dashboards.

### D. Designer-marketing-y polychrome ("Tran Mau Tri Tam / Setproduct" family)

**10. Tran's Core 2.0 dashboard builder** — <https://dribbble.com/shots/25782776-Core-2-0-Dashboard-Builder>

- Light surface, ~6 panels visible at once on 1440px, pastel multi-series charts.

**11. Tran's Unity Dashboard – Campaigns** — <https://dribbble.com/shots/14356166-Unity-Dashboard-Campaigns>

- Closest sibling to our ROAS use-case. Combines campaign leaderboards + multi-series chart + filter bar.

**12. Setproduct Analytics Dashboards** — <https://www.setproduct.com/dashboard-templates/analytics-dashboard>

- Modular block library — explicit named patterns like "KPI Grid 4×1", "Funnel", "Cohort Table".

### E. "Glass-heavy / Vision UI" family (caution)

**13. Vision UI Free + Pro (Creative Tim / Simmmple)** — see File 1 above.

- Mesh-gradient hero, glow strokes, dark navy. Best-in-class for static screenshots, worst-in-class for sustained operator use.

**14. Horizon UI** — <https://horizon-ui.com/>

- Sister-product to Vision; same trajectory: glassmorphism + gradients.

### F. Real-time / live-data patterns

**15. Smashing Magazine "UX for real-time dashboards"** — <https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/>

- Pattern: timestamp stamp + manual refresh + status chip (`Live` / `Stale` / `Paused`).
- Stale data should look stale — desaturate or dim cards whose source is >N min old.
- Skeleton UI > spinners.
- Banner pattern: `Offline … Reconnecting …` with auto-retry on exponential backoff.

### G. Anti-pattern reference

**16. Dashboard anti-patterns** — <https://startingblockonline.org/dashboard-anti-patterns-12-mistakes-and-the-patterns-that-replace-them/>

- The "12 mistakes" rubric (donut cemetery, vanity KPI wall, etc.) is the single most useful checklist for our review pass. Reproduced in the cross-cutting section below.

### H. KPI / sparkline-specific

**17. Power BI "Card visual" with sparklines** — <https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design>

- Pattern: headline value + variance + sparkline + reference label. 4-6 cards in the top row, conditionally-formatted to traffic-light status.

---

## Cross-cutting patterns

The patterns that recur across **3+ of the references above** and survive the "would I bet my ROAS dashboard on this?" test:

### 1. **Single accent color + disciplined semantic palette**

Linear (lime), Vercel (blue), Stripe (purple), Notion (blue) all converged here. Reserve color for action and status, never for decoration. Recommendation for us:

- One brand accent (current emerald is fine).
- Semantic 4-color set: success `#10B981`, warning `#F59E0B`, danger `#EF4444`, neutral `#94A3B8`.
- A separate 3-color chart palette for Meta / Google / TikTok that is **distinct from** the semantic palette — otherwise users will read "Google = red = bad".

### 2. **Hairline borders > drop shadows for elevation**

Vercel, Linear, Catalyst, Tran's whole catalogue. `1px solid` at ~6-8% opacity gives crisper edges, no Retina blur, and works in dark mode where shadows die. We currently use both — drop the shadows.

### 3. **Tabular numerics, always**

Inter (default `tnum`), Geist (default `tnum`), SF Pro (`tabular-nums`). Single CSS line: `font-variant-numeric: tabular-nums;` on every container that renders money or %. Hebrew-RTL doesn't change this — numerals render LTR even in RTL contexts.

### 4. **4-up KPI hero row, with `label / value / delta-chip / sparkline` structure**

shadcn, Power BI, Vision, Untitled, Setproduct, Tran. Cap at 4-6 cards. Label = small-caps muted; value = 28-32px tabular; delta = semantic pill; sparkline = inline ~60×24px.

### 5. **Filters as a visible scope line, not a flyout**

Anti-pattern #3 ("Surprise Filters"). Show timeframe + store + currency right under the page title. Critical for our multi-store context — the current "which store am I viewing?" answer should be **always above the fold**.

### 6. **Persistent slim sidebar (collapsible to icon rail)**

Catalyst, shadcn, Tran's Core, Untitled. 256px expanded / 64-72px collapsed. Capital-letter section headers for groups (`OVERVIEW`, `CAMPAIGNS`, `OPERATIONS`). Active-item treatment = filled background + 2-3px accent left-bar (or right-bar in RTL).

### 7. **Dual-mode color tokens via LCH or HSL pairs, theming via 3 root variables**

Linear's approach — Base + Accent + Contrast. Avoids the 98-token-per-theme explosion. Future-proofs us if we ever ship a high-contrast accessibility mode or a per-user theme.

### 8. **Data-freshness is a first-class UI element**

Smashing 2025, Power BI, Triple Whale all emphasised this. We already have `data_freshness` — surface it as a per-card badge (`Live`, `~10m`, `~2h`, `Stale`) rather than burying it in the operator panel. Stale cards should visually desaturate.

### 9. **Loading = skeletons matching final structure; empty = diagnostic + CTA**

Replace spinners with shimmer skeletons sized to the card. Empty states must include (a) why-empty diagnosis and (b) the single next action. No raw "No data."

### 10. **In-place drill, not page navigation**

Anti-pattern #9. Clicking a chart point opens a drawer/modal that preserves filters + breadcrumb. We already do some of this; codify it as "every drill is a drawer."

---

## Anti-patterns observed (what to NOT copy)

From the StartingBlock list + Vision UI + various Dribbble eye-candy:

1. **Mesh-gradient hero behind KPI numbers.** Beautiful in a static PNG, unreadable in production. (Vision UI's signature move.)
2. **Glowing / neon chart strokes.** ApexCharts demo specials. Reduce signal, add no information.
3. **Skeuomorphic 3D illustrations everywhere.** Designer-portfolio bait; freeze frame-rates and inflate bundle size.
4. **>4 chart series per chart.** "Rainbow heatmap of sadness."
5. **Donut clusters > 3 slices.** Donut cemetery.
6. **Color used decoratively (alternating row hues, accent borders, "brand" overlays on neutral charts).** Loses semantic precision.
7. **Hidden default filters.** Surprise filters — user thinks they're looking at all stores when they're filtered to one.
8. **Tables-as-dashboards.** 40 columns + 4000 rows = a CSV in disguise.
9. **Spinners that don't suggest structure.** Replace with skeleton.
10. **Vanity KPI walls** (numbers with no target, no delta, no sparkline, no semantic colour).
11. **Glassmorphism on functional surfaces.** NN/g says: reserve for one or two high-value moments. We have a serious dashboard, not a music app — glass adds zero value and costs contrast.
12. **Polychrome sidebar / decorative gradients on chrome.** Modern dashboards have monochrome chrome with content carrying the color.
13. **Apex-style glow filters on lines.** Unnecessary GPU cost, unnecessary distraction.
14. **3D pie / 3D bar.** Universally rejected since ~2018.
15. **Drill-to-nowhere navigation** that loses filter / breadcrumb context.
16. **Inconsistent units across cards** ($ here, raw number there, 2 decimals here, 0 there).
17. **Owner-less / freshness-less metrics.** No timestamp = no trust.

---

## Top 10 adapted recommendations

Ranked by impact-to-effort for our Hebrew-RTL, multi-store, multi-platform ROAS dashboard. Each row: **Pattern → What we'd take → ROAS-context adaptation → Where in our dashboard it'd apply.**

### 1. **Hairline-bordered card system, drop the shadows** *(very high impact, low effort)*

- **Take:** Vercel/Linear/Catalyst's `1px solid rgba(W,W,W,0.06-0.08)` borders, no shadows.
- **RTL adaptation:** Borders are direction-agnostic, no change needed. Make sure border tokens are RTL-symmetric (no `border-left`-only patterns; use `border-inline-start`).
- **Where:** Every card surface — Home KPI hero, Campaign cards, GoalTracker, TodayLive panel.

### 2. **Tabular numerics globally** *(very high impact, ~5 lines of CSS)*

- **Take:** `font-variant-numeric: tabular-nums;` on body + dedicated `.tabular` class.
- **RTL adaptation:** Numerals are LTR even inside RTL paragraphs; tabular-nums applies the same. Verify Hebrew/Arabic combining marks don't break vertical alignment in mixed lines (they don't, with Inter).
- **Where:** Every column of numbers — KPI values, table cells, axis labels, delta chips.

### 3. **4-up KPI hero with `label / value / delta / sparkline` template** *(high impact, medium effort)*

- **Take:** shadcn + Power BI + Vision + Tran convergence.
- **RTL adaptation:** Sparkline still flows left-to-right (time always flows LTR even in RTL UI — this is the W3C BIDI guidance). Delta chip sits to the *start* of the value (which is the right in RTL).
- **Where:** Home page hero row (Revenue, Spend, ROAS, Net Profit). Possibly TodayLive too.

### 4. **Single brand accent + 3-platform chart palette + 4-color semantic set** *(very high impact, medium effort)*

- **Take:** Linear's discipline.
- **RTL adaptation:** None needed (color is direction-agnostic).
- **Implementation:** Lock `--brand` (emerald), `--success/--warning/--danger/--neutral`, and `--meta-blue / --google-yellow / --tiktok-pink` as orthogonal palettes. CI test that no chart uses a semantic color and no semantic UI uses a chart color.
- **Where:** All chart series, all status pills, all delta chips, all alert banners.

### 5. **Visible scope line under page titles** *(very high impact, low effort)*

- **Take:** Anti-pattern #3 replacement.
- **RTL adaptation:** Read order is right-to-left, so the most important filter (Store) goes first on the right, then Range, then Currency. Use `<bdi>` around English store names to prevent BIDI mirroring.
- **Where:** Every top-level page (Home, Campaigns, P&L, Trends, Archive, Operator).

### 6. **Slim collapsible sidebar with capital-letter section headers** *(high impact, medium effort)*

- **Take:** Catalyst + Tran + Untitled UI convergence. 256px expanded / 72px collapsed.
- **RTL adaptation:** Sidebar lives on the *right* in RTL. Collapse chevron points *left* (toward content). Active-item accent bar is on the *right* edge of the item in RTL (the edge nearest content).
- **Where:** Global sidebar.

### 7. **Data-freshness badge per card + stale-state visual desaturation** *(high impact, medium effort)*

- **Take:** Smashing 2025 + Triple Whale.
- **RTL adaptation:** Badge text is mixed (English `Live` + Hebrew tooltip). Use `<bdi>` for the English label.
- **Implementation:** Tiny chip top-end of every data card: `● Live` (green dot) / `● ~10m` (gray) / `● Stale` (amber). Cards with `freshness > 30m` get `opacity: 0.7` on values + grayscale chart.
- **Where:** Every KPI card, every chart, every table row group. Already have the data — surface it.

### 8. **Empty-state pattern: friendly diagnosis + single CTA** *(medium impact, low effort)*

- **Take:** Tran + Polaris convergence.
- **RTL adaptation:** Illustration is direction-mirrored if it shows directional motion (arrow → ⇒ arrow ←). Use symmetric line-icon illustrations to avoid this entirely.
- **Where:** No-spend days in Campaigns; no-data days in Archive; new-store onboarding.

### 9. **In-place drill via drawer/modal, preserves filters** *(medium impact, medium effort)*

- **Take:** Anti-pattern #9 replacement.
- **RTL adaptation:** Drawer slides in from the *left* (opposite of LTR convention), close button on the right-end (start in RTL).
- **Where:** Click any KPI to open daily breakdown; click any campaign row to open ad-set/ad detail.

### 10. **Theme via 3 LCH variables (base + accent + contrast)** *(medium impact, high effort)*

- **Take:** Linear's variable consolidation.
- **RTL adaptation:** None.
- **Why bother:** Future operator high-contrast mode, per-user theming, and the ESLint rule "every `:root` token must have a dark-mode override" becomes much cheaper to maintain.
- **Where:** Token layer — `tokens.css` rewrite. Defer to a future phase; Phases 1-9 of the overhaul don't require it.

---

## Quick reference: hex codes worth committing to memory

| Source | Background | Card | Border | Text-hi | Text-lo | Accent | Success | Warning | Danger |
|---|---|---|---|---|---|---|---|---|---|
| Linear | `#08090A` | `#0F1011` | `#23252A` | `#F7F8F8` | `#8A8F98` | `#E4F222` | `#27A644` | — | `#EB5757` |
| Vercel Geist | `#000000` | `#0A0A0A` | `rgba(255,255,255,0.08)` | `#FFFFFF` | `#A3A3A3` | `#0070F3` | `#0070F3` | `#F5A623` | `#EE0000` |
| Notion | `#FFFFFF` | `#F7F6F3` | `rgba(0,0,0,0.06)` | `#37352F` | `#787774` | `#097FE8` | — | — | — |
| Polaris | (per merchant) | (per merchant) | (per merchant) | — | — | (purple) | green | (amber) | red |
| Recommended for us (dark) | `#0A0B0F` | `#12141A` | `rgba(255,255,255,0.07)` | `#F7F8F8` | `#8A8F98` | `#10B981` | `#10B981` | `#F59E0B` | `#EF4444` |
| Recommended for us (light) | `#FAFAFA` | `#FFFFFF` | `rgba(0,0,0,0.07)` | `#0A0B0F` | `#737373` | `#10B981` | `#10B981` | `#F59E0B` | `#EF4444` |

Suggested 3-platform chart palette (distinct from semantic): Meta `#1877F2`, Google `#FBBC04`, TikTok `#FE2C55`. These are the **brand colors of the platforms themselves** — so users intuitively map "the blue line = Meta" without a legend lookup.

---

## Sources

- <https://www.creative-tim.com/product/vision-ui-dashboard-react>
- <https://ui4free.com/uikit/figma-vision-ui-dashboard-react-mui-dashboard.htm>
- <https://github.com/creativetimofficial/vision-ui-dashboard-react>
- <https://medium.com/@appseed.us/vision-ui-dashboard-premium-mui-template-9112eb8a834b>
- <https://www.figma.com/community/file/1060952013207459371/vision-ui-dashboard-react-mui-dashboard-free-version>
- <https://www.figma.com/community/file/1140272887408902677/saas-selling-dashboard-admin-dashboard>
- <https://www.figma.com/@tranmautritam>
- <https://dribbble.com/tranmautritam>
- <https://dribbble.com/shots/25782776-Core-2-0-Dashboard-Builder>
- <https://dribbble.com/shots/16958016-Core-Dashboard-Builder-Home-light-dark>
- <https://dribbble.com/shots/16858056-Core-Dashboard-Builder-Dark-Components>
- <https://dribbble.com/shots/14356166-Unity-Dashboard-Campaigns>
- <https://dribbble.com/shots/10752883-Interface-Dashboard-v2>
- <https://linear.app/now/how-we-redesigned-the-linear-ui>
- <https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1>
- <https://linear.app/now/dashboards-best-practices>
- <https://vercel.com/geist/typography>
- <https://vercel.com/geist/colors>
- <https://seedflip.co/blog/vercel-design-system>
- <https://how-to-dashboard.vercel.app/>
- <https://ui.shadcn.com/examples/dashboard>
- <https://catalyst.tailwindui.com/docs/sidebar-layout>
- <https://vercel.com/templates/next.js/next-js-and-shadcn-ui-admin-dashboard>
- <https://www.untitledui.com/blog/react-dashboards>
- <https://designmd.cc/benchmarks/notion>
- <https://polaris-react.shopify.com/design/data-visualizations>
- <https://github.com/Shopify/polaris-viz>
- <https://www.triplewhale.com/blog/how-to-build-the-perfect-analytics-dashboard>
- <https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/>
- <https://startingblockonline.org/dashboard-anti-patterns-12-mistakes-and-the-patterns-that-replace-them/>
- <https://tabulareditor.com/blog/kpi-card-best-practices-dashboard-design>
- <https://www.setproduct.com/dashboard-templates/analytics-dashboard>
- <https://cloudscape.design/foundation/visual-foundation/data-vis-colors/>
- <https://www.nngroup.com/articles/glassmorphism/>
- <https://mattstromawn.com/projects/stripe-dashboard/>

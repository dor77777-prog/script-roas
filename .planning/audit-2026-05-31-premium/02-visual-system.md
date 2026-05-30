# Visual System Audit — Premium 2026 Direction

Baseline: `main @ afc9bf6` (post Tasks 1-29 design system overhaul).
Scope: design tokens, primitives, theme switching, platform/store/status color identity, typography, gradients, shadows, primitives consistency, iconography, bidi-isolation.
Lens: Linear / Stripe / PostHog / Vercel — what is the gap between this codebase and a 2026 premium internal-tool feel.

---

## Token system review

The token layer is the strongest part of the codebase. `dashboard-web/src/app/globals.css:13-229` lays out a credible OKLCH-based system: surfaces, text, borders, accent, ROAS status (red/orange/green/blue/gray), a warning chip family, chart axis, hero gradient, three store hues, and eight annotation kinds — all with a `[data-theme="dark"]` override block. Tailwind picks them up via CSS-variable colors in `tailwind.config.ts:26-65`. The ESLint guards in `eslint.config.js:120-122` (`no-hex-color-in-components`, `no-dark-variant-in-components`, `no-raw-button-in-components`) are an exemplary CI gate and rare to find in a real codebase.

What's good:
- OKLCH chroma/lightness math is internally consistent — status `-bg`/`-fg` pairs cluster around the same hue families, and the dark overrides at `globals.css:179-197` were explicitly tuned for white-on-color contrast through a documented hotfix chain.
- Surfaces use a three-step elevation stack (`--surface-canvas` → `--surface-elevated-1` → `--surface-elevated-2`) with a separate `--surface-overlay` for modals — this is the right shape.
- Annotations and per-store hues are theme-aware, including `-bg`/`-fg` chip-pair tokens (`globals.css:106-124`, `globals.css:211-228`). Few internal tools bother.
- The decision documented at `globals.css:142-143` — "`--border-subtle` is decorative-only in dark mode (fails WCAG 1.4.11). Use `--border-default` for interactive element outlines" — is the kind of judgement most design systems never bother making.

What's missing or inconsistent (token layer):

1. **Dual color systems coexist** (`tailwind.config.ts:67-114`). The "LEGACY" hex palette (`background: '#f6f9fc'`, `primary.*`, `roas.*`, `text.*`) is still alive — it's a parallel non-token-driven world. Components like `BillingSettings.tsx:86-87`, `PnLBreakdown.tsx:58-59`, `CampaignsTableRow.tsx:303` still hit the legacy `purple-100/700` and `blue-100/700` Tailwind palette directly. The note says "deleted in Plan 7 (polish) once nothing uses them" but it hasn't been. Until that day, every new component has two valid sources of truth for "what is the surface color." That's the #1 visual coherence risk.

2. **Hex defaults inside `:root` chart tokens** (`globals.css:42-50`). The light-mode chart palette is defined as raw hex (`#2563eb`, `#d97706`, `#ef4444`, `#a855f7`, `#10b981`, `#06b6d4`, `#ec4899`, `#84cc16`). Dark mode is OKLCH (`globals.css:157-165`). Mixing scales means the light/dark transition is not perceptually balanced — the OKLCH dark values are explicitly L~70-78%, but the light values are whatever the Tailwind v3 palette happens to land on (which is not L-anchored at all). The hexes also bypass the CI gate, since the rule fires only on files in `/components/`.

3. **No `--space-*` scale.** Padding rhythms in the primitives (`Sheet`, `Dialog`, `Tabs`, `Card`, `Input`, `Stat`, `Button`) are written as raw Tailwind classes (`px-3 py-2`, `px-5 py-4`, `px-4 sm:px-5 py-2.5 sm:py-3`, `p-1`, `px-2.5 py-1.5`). There's no shared 4/8/12/16/24 spacing token, which is why `CardHeader` uses `px-5 py-4`, `CardBody` uses `px-5 py-3`, `Stat` uses `px-3 py-2`, `InsightCardRow` uses `px-4 sm:px-5 py-2.5 sm:py-3`, and `TableCell` uses `px-3 py-2`. Each primitive shipped with its own padding logic; nothing enforces rhythm across them.

4. **No motion tokens** beyond `--duration-DEFAULT/slow` in `tailwind.config.ts:184-187`. The codebase invents `animation-duration: 180ms` for view transitions (`globals.css:352`) and `220ms` for drawer panel (`globals.css:364`), `240ms` for `fade-in` (`tailwind.config.ts:207`), `320ms` for `fade-in-up` (`tailwind.config.ts:208`). A premium system would have `--motion-fast`/`base`/`slow` named tokens used by every consumer.

5. **No radius scale token semantic**. `tailwind.config.ts:174-182` defines `sm/md/lg/xl/2xl/3xl` as raw pixel values but components reference them by Tailwind names; there's no `--radius-control` / `--radius-card` / `--radius-surface` semantic layer to keep a button and a chip at the same radius without scattering `rounded-md`/`rounded-lg`/`rounded` literal classes (see the count in primitives: 13× `rounded-md`, 3× `rounded-lg`, 2× `rounded-xl`, 1× `rounded-sm`, 2× bare `rounded`).

6. **`::selection` and scrollbar use raw hex** (`globals.css:255-256`, `globals.css:265-269`). These are token-eligible. Worse: in dark mode the scrollbar `background: #d9e2ec` and `border: 2px solid #f6f9fc` are light-mode-only values that will look wrong on a dark surface. There's no `[data-theme="dark"]` override for the scrollbar block. The skeleton shimmer at `globals.css:312-322` has the same problem — its gradient is light-mode hex with no dark override.

7. **`focus-visible` ring is hard-coded** (`globals.css:295`). `box-shadow: 0 0 0 3px rgba(13, 54, 128, 0.20)` uses the legacy navy. It does not adapt to dark mode and it does not match `tailwind.config.ts:170` `focus: '0 0 0 3px rgba(13, 54, 128, 0.18)'`. The primitives separately use `focus-visible:ring-2 focus-visible:ring-accent` (`Button.tsx:8`, `Input.tsx:12`, `Select.tsx:20`, `Switch.tsx:16`, `Tabs.tsx:31`). Two focus systems compete.

8. **Chart-axis token is defined twice and they disagree**. `globals.css:94` declares `--chart-axis: oklch(60% 0.015 250 / 0.6)`. But `ChartContainer.tsx:36` overrides it locally to `var(--text-muted)` — and the chart-utility module `chartColors.ts:8` exports `CHART_AXIS_COLOR = 'var(--chart-axis)'`. Three different effective values for the same logical thing depending on the call path.

---

## Light mode findings

Surface stack distinction (`globals.css:14-18`):
- `--surface-canvas` L=99% / `--surface-elevated-1` L=100% / `--surface-elevated-2` L=97%.
- Elevation-1 sitting *above* canvas while being whiter than canvas works only because canvas has a 0.005-chroma warm tint. The visual delta canvas-vs-elevated-1 is roughly ΔL=1 — barely perceptible. This is intentional Stripe-style restraint, but combined with `border-default` at L=90% it means cards float on hairlines, not on elevation. On a hi-DPI screen at typical viewing distance this reads as "no elevation."
- `--surface-elevated-2` (L=97%) is correctly *lower* than elevated-1 visually (which is right — it's used for sub-bands like `TableHead` at `TableBase.tsx:21` and `Tabs.tsx:15`). But because canvas is L=99%, elevated-2 (L=97%) creates *more* contrast with canvas than elevated-1 does (ΔL=2 vs ΔL=1). This inverts the elevation grammar: a "sub-band" is more visually distinct from canvas than the "primary card surface." Cards lose their hierarchy when placed on canvas.

Text contrast (`globals.css:21-24`):
- `--text-primary` at oklch(20% 0.02 250) on canvas (99%) — strong, ~13-15:1, AAA.
- `--text-muted` at oklch(60% 0.015 250) on `--surface-elevated-2` (97%) — approximately 4.0-4.2:1. **Risk: AA Large only**, not AA Normal. This is the body color used in `Stat.tsx:39` (`text-ink-muted` for the label), `CardDescription` (`Card.tsx:46`), all `TableHeaderCell` text (`TableBase.tsx:51`), `Tabs` inactive triggers (`Tabs.tsx:29`), and many table/sub-label uses. At `text-xs` / `text-2xs` this fails 4.5:1.
- `--text-subtle` at oklch(75% 0.01 250) on canvas — approximately 2.4:1. Used in `CampaignDrawer.tsx:817` as a separator dot color, also `ProductPickerModal`/`CollapsibleSection` glance text. **Fails WCAG even for AA Large at any size.** Tokens label it "subtle" so they're aware, but it's used on visible text (dot separators in metadata strips), not purely decorative.

ROAS status backgrounds (`globals.css:62-80`):
- `-bg` tokens at L=90% with chroma 0.10-0.11. Paired `-fg` at L=22-25% with chroma 0.04 — explicitly tuned for AAA. This works. The badge tone consumers (`Badge.tsx:5-12`, `BADGE_TONE_BG`) and the chips in `HeroOverview.tsx:85-91` are safe.
- However: the `-bg` color reads as a tint of canvas (canvas L=99%, bg L=90% — ΔL=9). That delta is fine for AA Large but small enough that two adjacent status backgrounds (orange L=91% next to green L=90%) look like the same chip surface from across the desk. The status colors are *carrying meaning* via hue only, with very low L contrast — a colorblind operator (8% of male users) cannot tell red-bg from green-bg.

Border treatment (`globals.css:27-29`):
- `--border-default` at L=90%, `--border-subtle` at L=94%. Subtle is essentially invisible on `--surface-elevated-2` (L=97%) — ΔL=3. Used everywhere: `TableBase.tsx:21,29`, `Card.tsx:60` (footer), `InsightCardGroup.tsx:148`, `CardFooter`. A premium feel demands either a clean hairline (ΔL≥5 minimum) or no border at all + elevation. Right now there's a "phantom border" everywhere.

Specific contrast bugs:
- `CampaignsTableRow.tsx:277` — round badge `bg-elevated2 text-[10px] font-bold text-ink-secondary tabular-nums`. The 10px digit on `--surface-elevated-2` (L=97%) using `text-secondary` (L=40%) is the smallest text in the index column. 10px at AAA needs 7:1; this is ~7-8:1 so it works, but it's right at the boundary and bold helps.
- `HeroOverview.tsx:683` — `accent === 'negative' ? 'text-orange-200' : 'text-white'`. `text-orange-200` (#fed7aa) on the hero gradient violet/blue at oklch ~32-48% L produces approximately 6:1. OK but the *meaning* of orange-200 here is "negative" — using a warm pastel for negative is non-standard and visually competes with the chart's amber annotations.
- `MetaShopifyReconciliation.tsx:701-704` cites slate-700 for TikTok — slate-700 (#334155) is L~35% which on canvas (L=99%) is fine. But this is a hand-picked override of `CHART_COLORS.tiktok` (oklch dark gives L~72%) — meaning the *swatch* in the tooltip uses one color and the *line* in the chart uses another. Inconsistent identity.

---

## Dark mode findings

The dark mode is genuinely above-average for an internal tool, but it's an "inverted light mode" in several places that matter.

Surface stack (`globals.css:130-133`):
- `--surface-canvas` L=15%, elevated-1 L=19%, elevated-2 L=23%. ΔL=4 per step. Good — the dark mode is *more* visually layered than light mode (where steps are ΔL=1-2). This is correct because at low L, perceptual deltas are smaller, so larger numeric deltas are needed. Premium territory.

Text contrast (`globals.css:135-139`):
- `--text-primary` L=95% on canvas L=15% → ~15:1, AAA. 
- `--text-muted` L=70% on elevated-1 L=19% → ~7:1, AAA.
- `--text-subtle` L=45% on canvas L=15% → ~3.5:1. **Fails AA Normal.** Same problem as light mode but at a different point in the scale. Used on the same separator-dot patterns.

Borders (`globals.css:144-146`):
- `--border-subtle` L=28% on canvas L=15% — ΔL=13 → ~1.7:1 sRGB. Decorative-only is the right call. Documented at `globals.css:142-143`.
- `--border-default` L=35% on canvas L=15% — fine for interactive outlines. **BUT** every consumer that wraps in `border-line-subtle` (and there are many: `Tooltip.tsx:20`, `TableBase.tsx:21,29`, `CampaignDrawer.tsx:800`, `InsightCardGroup.tsx:149`) is using a decorative-only border for what is structurally a real boundary. In dark mode, the table row separators in `TableBase.tsx:29` will be effectively invisible — operator-visible regression.

Hero gradient (`globals.css:207-209`, `HeroOverview.tsx:269-274`):
- Light: explicit dark navy gradient `oklch(20% 0.12 260)` → `oklch(48% 0.20 260)` — a real brand statement.
- Dark: uses `dark:from-accent dark:via-accent/80 dark:to-accent/55`. This is **NOT** the dark gradient tokens. It overrides them with the accent indigo at varying alpha, producing a flat-ish gradient. The thoughtful `--gradient-hero-from/via/to` tokens defined in dark mode at `globals.css:207-209` are **never consumed** — `HeroOverview.tsx:273` uses `dark:` variants directly. Three lines of token work going to waste.
- Decorative cyan glow at `HeroOverview.tsx:288`: `bg-cyan-300/15`. Raw Tailwind. Same in both modes. In dark mode the cyan glow on the dark-indigo card is decoration-OK; in light mode the cyan glow on the bright navy gradient is fine; but it never adapts to either context properly.

Dark mode "feels like a weak inversion" indicators:
- Hero gradient bypassed (above).
- Scrollbars (`globals.css:262-269`) — light-mode hex, no dark override. Native scrollbars on a dark page with `#d9e2ec` thumbs is a tell.
- Skeleton shimmer (`globals.css:312-322`) — light-mode rgba values, no dark override.
- `::selection` (`globals.css:254-257`) — `rgba(13, 54, 128, 0.18)` background + `color: #0d253d`. On dark mode the text color `#0d253d` (deep navy) on the navy selection rgba is unreadable.
- `focus-visible` global ring at `globals.css:295` — navy 20% — fades into the dark canvas.
- `BillingSettings.tsx:86`, `PnLBreakdown.tsx:58`, `CampaignsTableRow.tsx:303` use `bg-blue-100`/`bg-purple-100`/`text-blue-700`/`text-purple-700`. These never theme-swap. In dark mode the legacy "blue-100" pastel chip on a dark surface is the giveaway that this is not a real dark mode.

Status chip `-bg` in dark mode (`globals.css:179-197`):
- All five families share L=42-45% with chroma ~0.14. They sit clearly above canvas (ΔL ~27-30). The hotfix chain produced legit chips. But: white text (`-fg` L=99%) on L=42-45% gives ~3.5-5:1 sRGB. Documented as "AA Large only" at `globals.css:175-178`. The 10px chip text in `InsightCardGroup.tsx:170` (`text-[10px] font-bold`) is **below** AA Large threshold. Bold helps but doesn't rescue 10px <4.5:1.

---

## Platform / store / status colors

### Platform identity

`chartColors.ts:13-19` defines `PLATFORM_TOKENS` mapping each platform to a CSS-var. Globally:

| Platform | Light hue | Dark hue | Light hex | Dark OKLCH |
|---|---|---|---|---|
| Meta | blue 260° | blue 260° | #2563eb | L70 |
| Google | amber 60° | amber 60° | #d97706 | L75 |
| TikTok | red 25° | red 25° | #ef4444 | L72 |
| Organic | violet 305° | violet 305° | #a855f7 | L75 |
| Shopify | green 155° | green 155° | #10b981 | L75 |

Identity holds across modes — good. The dark values are L-anchored, light values are not (Tailwind hex). Cross-mode perceptual symmetry will drift.

### Color collisions

1. **TikTok red vs status-red.** TikTok `--chart-platform-tiktok` light = #ef4444 (red 25°). `--status-red` light = `oklch(60% 0.18 25)` — same hue family, same lightness band. In a chart that has both a TikTok line and a "ROAS bad" reference, **the user cannot tell whether red means "TikTok" or "below 2.0."** This is the worst platform/status collision in the system. Same issue dark mode: `--chart-platform-tiktok` dark L72 hue 25 vs `--status-red` dark L72 hue 10 — very close.

2. **Google amber vs status-warning.** Google `--chart-platform-google` light = #d97706 (amber 60°), dark = oklch(75% 0.16 60). `--status-warning` light = oklch(70% 0.14 75), dark = oklch(78% 0.18 75). 15° apart in hue, similar L. The warning chips look like Google channel chips. Hover over a Google line and the tooltip's warning chip color (if any) blends.

3. **Shopify green vs status-green.** Shopify `--chart-platform-shopify` light = #10b981 (green 155°). `--status-green` light = oklch(60% 0.16 145). 10° apart. The "above target ROAS" green is essentially the Shopify color. Anywhere a chart has both a Shopify reference line and a ROAS reference line, these collide.

4. **Organic violet vs annotation-sale violet.** `--chart-platform-organic` dark = oklch(75% 0.18 305). `--annotation-sale` dark = oklch(75% 0.20 305). **Identical L, identical hue.** A sale annotation pin on a chart that has an Organic line is the same color as the line.

5. **Store-uzoshop cyan vs annotation-creative cyan.** `--chart-store-uzoshop` dark = oklch(75% 0.13 200). `--annotation-creative` dark = oklch(75% 0.18 200). Identical L, identical hue, only chroma differs slightly. On the chart for uzoshop's view, creative annotations are invisible against the store line color.

6. **Store-usmile lime vs annotation-launch green.** `--chart-store-usmile` light = #84cc16 (lime ~130°). `--annotation-launch` light = oklch(55% 0.18 145). 15° apart, similar value. Likely confused on the chart.

7. **Status-blue vs accent.** `--accent` light = oklch(55% 0.18 260). `--status-blue` light = oklch(60% 0.16 240). Both blue, 20° apart. The "above target ROAS" blue chip and the active accent button live in the same hue family — when both appear on the same screen they fight for being the call-to-action.

### Cross-surface platform consistency

`MetaShopifyReconciliation.tsx:693-723` correctly uses `CHART_COLORS.meta/google/tiktok/organic/shopify` for tooltip swatches **and** line strokes — consistent. Good.

`ProductChannelBreakdown.tsx:130-132` uses the same tokens for stacked-bar segments — consistent.

But `CampaignsTableRow.tsx:375-378` renders the platform as a *text label only* (`<bdi dir="ltr">{a.platform}</bdi>`) — no color, no icon, no swatch. In `CampaignDrawer.tsx:818` again platform is text-only. In the operator tables there is no platform-color identity at all — only in charts. The platform-identity language exists in some surfaces and not others. This is the kind of inconsistency that makes "premium" feel impossible.

There is no `PlatformBadge` primitive. Each consumer reinvents the visualisation.

### Store consistency

`format.ts:148-152` and `storeColors.ts:19-23` both export store-color maps and the names overlap. `format.ts:STORE_HUES` returns `{ fg, bg }` for badges, `storeColors.ts:STORE_COLORS` returns just `fg` for charts — but they both contain the same three keys and route through the same CSS vars. Two modules, one source of truth. A new developer adding a 4th store has to update *both* (and the fallback palettes in each, which diverge: `format.ts:168` uses `['#06b6d4', '#ec4899', '#84cc16', '#b45309', '#7c3aed']` but `storeColors.ts:25-31` uses `['#a855f7', '#dc2626', '#16a34a', '#0ea5e9', '#f59e0b']`).

Additionally `format.ts:162-164` re-exports a *third* mapping `storeBadgeHex()` for server-side WhatsApp summaries hardcoded to light-mode hex. The values match `STORE_HEX_LIGHT` at `format.ts:157-161`. Four sources of truth for "what color is uzoshop." This is the schism the comment at `format.ts:144-147` claims was *resolved* by Phase E1.6.1.

### Status palette across surfaces

The ROAS band tones (red/orange/green/blue/gray) are wired through `roasLabel()` (`analytics.ts:423-428`) and consumed in `Badge.tsx:5-12`, `Stat.tsx:16-23`, `InsightCard.tsx:24-29`, `Sparkline.tsx:16-22`, `HeroOverview.tsx:85-91`. Each consumer maps the tone string to *its own* className set. Five separate token→className maps, all hand-rolled, none cross-referenced. A `ToneSwatch`/`statusTone` primitive that returns the `bg`/`fg`/`border` className triple would collapse this. Today, adding a new tone means editing five files.

---

## Primitives consistency

Counting the actual `components/ui/*` set: `Button`, `Badge`, `Card`, `Dialog`, `Input`, `InsightCard`, `Select`, `Sheet`, `Sparkline`, `Stat`, `Switch`, `TableBase`, `Tabs`, `Tooltip`, `AiInsightPill`, plus the chart sub-primitives.

### Radius

| Primitive | Radius |
|---|---|
| Button sm/md | `rounded-md` (`Button.tsx:20-21`) |
| Button lg | `rounded-lg` (`Button.tsx:22`) |
| Badge | `rounded` (`Badge.tsx:17`) — not `rounded-sm`/`rounded-md`, **bare `rounded` = 0.5rem** |
| Card | `rounded-xl` (`Card.tsx:6`) |
| Stat | `rounded-md` (`Stat.tsx:13`) |
| InsightCard flat | `rounded-lg` (`InsightCard.tsx:20`) |
| InsightCardRow icon badge | `rounded-md` (`InsightCard.tsx:237`) |
| Dialog | `rounded-xl` (`Dialog.tsx:22`) |
| Sheet | no radius (full-edge) |
| Select trigger | `rounded-md` (`Select.tsx:19`) |
| Select item | none |
| Tabs list | `rounded-md` (`Tabs.tsx:15`) |
| Tabs trigger | `rounded-sm` (`Tabs.tsx:28`) |
| Input | `rounded-md` (`Input.tsx:10`) |
| Switch | `rounded-full` |
| Tooltip | `rounded-md` (`Tooltip.tsx:20`) |
| AiInsightPill | `rounded-md` (`AiInsightPill.tsx:32`) |

`Badge` uses bare `rounded`, `Tabs trigger` uses `rounded-sm`, controls use `rounded-md`, mid-surfaces use `rounded-lg`, cards/dialogs use `rounded-xl`. **Almost** a scale, but: Badge should be `rounded-sm` to match Tabs trigger; nothing reads consistently. There is no `radius-control` / `radius-card` semantic.

### Elevation

- `Card` default: `shadow-sm`. Card elevated: `shadow-md`.
- `Dialog`: `shadow-xl`.
- `Sheet`: `shadow-xl`.
- `Select content`: `shadow-md`.
- `Tooltip`: `shadow-md`.
- `Tabs trigger active`: `shadow-sm`.

29 components use `shadow-sm`, only one uses `shadow-card` and one `shadow-cardHover` — the bespoke layered tokens at `tailwind.config.ts:163-171` are essentially unused. `shadow-elevated` is used 14 times in consumers but bypassed in primitives. The carefully tinted shadow scale is decorative; the actual elevation language is the off-the-shelf Tailwind scale.

### Border treatment

- `Card`: `border border-line`
- `Stat`: `border` (tone variant adds color, neutral adds `border-line`)
- `Dialog`: `border border-line`
- `Sheet`: side-specific border-e/border-s (uses base `border-line` set on root)
- `Select trigger`: `border border-line`
- `Input`: `border border-line`
- `Tooltip`: `border border-line`
- `Switch`: `border border-line`
- `InsightCard flat`: variant-driven
- `TableBase rows`: `border-line-subtle` (different — invisible in dark mode per WCAG 1.4.11 note in tokens)
- `Tabs`: no border
- `Badge`: no border

`TableBase` uses subtle borders that are documented as decorative-only, so dark-mode table-row separators effectively vanish. Tabs and Badge have no border at all — visually they read like distinct families.

### Padding

The primitive padding values are all over the place (see token-system review item #3). The clearest example: `Card` uses `px-5 py-4` for header / `px-5 py-3` for body / `px-5 py-3` for footer; `Stat` uses `px-3 py-2` for the whole tile; `InsightCardRow` uses `px-4 sm:px-5 py-2.5 sm:py-3`; `TableCell` uses `px-3 py-2`; `Dialog` uses `p-6`; `Tooltip` uses `px-2.5 py-1.5`. Three distinct horizontal rhythms (`px-3` / `px-4` / `px-5` / `px-6`) and four vertical (`py-2` / `py-2.5` / `py-3` / `py-4`).

### Focus rings

Every primitive uses `focus-visible:ring-2 focus-visible:ring-accent` except: `Button` adds `focus-visible:ring-offset-2 focus-visible:ring-offset-canvas` (`Button.tsx:8-9`), `Sheet` has no focus-visible (relies on Radix), `Dialog` has no focus-visible (relies on Radix), `Tooltip` has no focus-visible. The global `:focus-visible` ring in `globals.css:293-297` adds a navy box-shadow on **every** focusable element — which *layers* underneath the primitives' Tailwind ring, producing a double ring on Buttons/Inputs/Selects. Visible on hover-focus state.

### Iconography

61 components import from `lucide-react`. Lucide is consistent stroke-width (default 2). However:
- Icon size convention is mostly `size={14}` (81 uses), then `size={16}` (38), then `size={12}` (35), `size={11}` (24), `size={18}` (17), `size={20}` (14), `size={10}` (5). Seven distinct sizes for what should be a 3-step scale (sm/md/lg).
- `ProductPickerModal.tsx:342` overrides Lucide's stroke with `strokeWidth={3}` for a Check icon — only place this happens. Once you start adjusting stroke per icon, the visual rhythm is gone.
- Emoji are mixed with icons in the primitives:
  - `PerStoreCards.tsx:119` `🏪`
  - `CampaignsTableRow.tsx:320` `⏸`
  - `CampaignsTableRow.tsx:340` `🏷️`
  - `CampaignsTableRow.tsx:363` `⏳`
  - Annotation system: `ANNOTATION_KIND_EMOJI` (`annotations.ts:50`) — 8 kinds, all emoji.

Emoji are platform-rendered (Apple-color on macOS, Microsoft-color on Windows, etc.). In a Linear/Stripe-tier dashboard the visual identity is intentionally Lucide-only or fully custom. Emoji mixed with Lucide is the single biggest "this is a hobby tool" tell.

### Compound API maturity

`InsightCard` has a real namespace API (`InsightCard.Group`/`InsightCard.Row` at `InsightCard.tsx:285-286`) plus a flat variant — a sign of maturity. `Card` has `Card.Header`/`Body`/`Footer` patterns (`Card.tsx:30-63`) — except they are *not* attached to Card as a namespace, they are exported standalone. Consumers do `<CardHeader>` not `<Card.Header>`. Inconsistent compound conventions.

The other primitives (`Sheet`, `Dialog`, `Tabs`) are pure Radix re-exports with style on top — no compound enrichment. There's no `<Sheet.Header>`, `<Dialog.Header>`, etc.

---

## Typography ramp

`tailwind.config.ts:147-159` defines:

| Class | Size | Line | Tracking |
|---|---|---|---|
| `text-2xs` | 11px | 15.2px | +0.01em |
| `text-xs` | 12px | 16.8px | +0.005em |
| `text-sm` | 14px | 20.8px | — |
| `text-base` | 16px | 24.8px | — |
| `text-lg` | 17px | 26px | -0.005em |
| `text-xl` | 20px | 28px | -0.01em |
| `text-2xl` | 24px | 29.6px | -0.014em |
| `text-3xl` | 30px | 34px | -0.018em |
| `text-4xl` | 36px | 40px | -0.022em |
| `text-5xl` | 48px | 52px | -0.026em |

The ramp itself is thoughtful — letter-spacing tightens on display sizes, which is a Stripe move. But:

1. **No semantic typography tokens.** Headings are class-stacked at each consumer:
   - Page H2: `text-base sm:text-lg font-semibold` (`TabHeader.tsx:21`)
   - Section H2: `text-sm sm:text-base font-semibold tracking-tight` (`SectionIntro.tsx:54`, `GoalTracker.tsx:130/158`, `CollapsibleSection.tsx:72`)
   - Panel H3: `text-sm font-semibold` (`AttributionAnalysisPanel.tsx:39`, `AdSetTable.tsx:88`, `MetaShopifyReconciliation.tsx:438`, `CohortComparisonPanel.tsx:334`)
   - Drawer H2: `text-base sm:text-lg font-semibold tracking-tight truncate` (`CampaignDrawer.tsx:807`)
   - Drawer H2 (Ads): `text-sm sm:text-base font-bold tracking-tight` (`AdsDrawer.tsx:335`) — uses `font-bold` not `font-semibold`. Inconsistent.
   - Insights H2: `text-base sm:text-xl font-bold tracking-tight leading-tight` (`InsightsBoard.tsx:243`, `PnLBreakdown.tsx:165`).
   - Quick band H2: `text-sm font-medium` (`HomeSummaryBand.tsx:11`, `HomeLiveBand.tsx:9`, `HomePerStoreBand.tsx:14`) — drops to `font-medium`.

   That's **5+ visually distinct H2 styles** for the same semantic level. There's no `Heading` primitive, no `<Display>`/`<H1>`/`<H2>`/`<Caption>`/`<Label>` named element.

2. **Font weight distribution** (counts): `font-medium` 249, `font-semibold` 170, `font-bold` 47, `font-light` 4. `font-light` is correctly used only by HeroOverview's display numerals (`HeroOverview.tsx:681`, etc.) per the Stripe-bridge spec — good. But `font-bold` (47 uses) competes with `font-semibold` (170 uses) for what is structurally the same role. No clear assignment of weight to role.

3. **Tabular numerics resolution** (`globals.css:246-252`). `.tabular-nums` is wired to Rubik-first; this is correct (Heebo lacks tnum, documented at `globals.css:242-245`). But the `font-numeric` Tailwind utility defined at `tailwind.config.ts:132-137` is never used in any consumer — `grep -r "font-numeric" src/` returns zero. The CSS-class approach works but the canonical utility is unused.

4. **`leading-` overrides** are scattered: `leading-tight`, `leading-snug`, `leading-relaxed`, `leading-none`. Same headings use different leading without rhyme. `HeroOverview` h2 at line 310 uses `leading-snug`; `TabHeader` H2 at line 21 uses `leading-tight`. The `tailwind.config.ts:147-159` ramp already ships explicit line-heights — these overrides are fighting the scale.

5. **Hebrew + Latin numerics in same line**. `<bdi dir="ltr">` is used 38 times but only in numeric/identifier contexts. The store name display `<span className="truncate">🏪 <bdi dir="ltr">{agg.store}</bdi></span>` at `PerStoreCards.tsx:119` is correct. But `CampaignsTableRow.tsx:375-378` mixes platform name and store name as separate `<bdi>` blocks separated by Hebrew middots — that's three bidi runs that re-isolate. The bidi handling is *correct* but not *systematic* — no `<NumericText>` / `<Identifier>` primitive enforces it.

---

## Gradients, shadows, elevation

### Gradients

Single intentional gradient: the hero card (`HeroOverview.tsx:264-274`). Three-stop linear at 135deg, navy → indigo. Light mode reads as the brand hero; dark mode falls back to accent variants (per item above, **bypassing** the dark gradient tokens at `globals.css:207-209`).

The hero glow at `HeroOverview.tsx:288` is a radial cyan blur via `bg-cyan-300/15 blur-3xl` — a single decorative element that does not appear anywhere else in the system. The store card headers at `PerStoreCards.tsx:115-117` use a flat colored band per store. No other gradient elsewhere.

For a premium 2026 feel, this is *too restrained*. Linear and Stripe use subtle gradient washes on icon backplates, hover states, and on top-of-card highlights. Here every other surface is flat. The system has one moment of visual richness (the hero) and nothing else.

### Shadows

The Tailwind config's `shadow-card` / `shadow-cardHover` / `shadow-elevated` / `shadow-innerHighlight` tokens at `tailwind.config.ts:161-172` were carefully tuned with cool-tinted rgba — and they are **mostly unused**. Counts: `shadow-card` 1, `shadow-cardHover` 1, `shadow-innerHighlight` 0. The default `shadow-sm` (29 uses) is the Tailwind default, not the custom one. The carefully tinted shadow scale is dead code.

The shadow on the floating `recharts-default-tooltip` at `globals.css:282` is `var(--shadow-md)` — but `--shadow-md` is **never defined** in `globals.css` or `tailwind.config.ts`. Falls through to nothing. Recharts tooltips have no shadow currently.

In dark mode, shadows do not adapt. `shadow-sm` is `0 1px 2px 0 rgba(15, 31, 81, 0.05)` — a cool-tinted navy shadow on a dark navy canvas. On dark mode it should be either a black shadow or none (instead use elevation borders). Not adapted.

### Elevation language

There is no consistent surface-stack story. A drawer (`Sheet`) and a dialog (`Dialog`) both use `shadow-xl` — fine. But a popover (`Select content`) uses `shadow-md`, a Tooltip uses `shadow-md`, a Card uses `shadow-sm`. The ladder shadow-sm → shadow-md → shadow-xl is OK but it's the Tailwind default — no signature.

---

## Premium-2026 gaps (the big picture)

For this system to feel Linear / Stripe / PostHog tier:

1. **Pick one source of truth and burn the other.** The token system is good. The legacy palette in `tailwind.config.ts:67-114` plus the raw Tailwind colors in 6+ consumers makes every surface a coin-flip. Until `bg-primary-50` / `text-purple-700` / `bg-roas-greenBg` are physically removed and the legacy palette block deleted, the system is a draft. A Linear engineer doesn't pick between two paint sets; they pick a paint.

2. **Build a Typography primitive.** 5+ different H2 styles, weights all over the map, leading inconsistent. A `<Heading level="display" | "section" | "panel">` + `<Text variant="body" | "caption" | "label">` would collapse 50+ ad-hoc combinations. This is the single biggest visual coherence lever.

3. **Build a `PlatformBadge` / `PlatformIdentity` primitive.** Currently the platform identity exists as a chart color and nowhere else. Tables, drawers, and the campaign-name strip show platform as plain text. Stripe-tier means a Meta line on a chart shares its color identity with a Meta chip on the campaign row, with the Meta favicon next to the campaign name, with the Meta header section in the drawer. None of that integration exists.

4. **Resolve the TikTok-red ↔ status-red collision.** This is operational, not cosmetic — a single number on a chart could mean either thing. Either remap TikTok to a different hue family (pink? rose? warm magenta?) or remap status-red to a different hue (terracotta? maroon?). The Organic/sale-annotation, Shopify/status-green, and uzoshop/creative-annotation collisions are the same class.

5. **Build a real dark mode.** Hero gradient bypasses tokens, scrollbar/skeleton/selection/focus-ring stay light, status-bg text is below AA at 10px, border-line-subtle is documented as invisible but still used as a row separator everywhere. Dark mode passes "I see it" but fails "I can use it for 8 hours."

6. **Replace emoji with Lucide icons.** Annotation kinds, freshness chips, store cards, "off" markers — all emoji. Lucide has equivalents for every concept in the system. Premium tools never mix.

7. **Introduce a motion + spacing scale.** Inline `200ms`, `220ms`, `240ms`, `180ms`, `320ms` durations + ad-hoc `px-3`/`px-4`/`px-5`/`px-6` padding + `gap-1`/`gap-1.5`/`gap-2`/`gap-2.5`/`gap-3` everywhere is the symptom. A 4/8/12/16/24 spacing scale and a fast/base/slow motion scale referenced by every primitive collapses dozens of ad-hoc decisions.

8. **Layer real elevation back in.** Custom shadow tokens exist but are unused. Build a 3-tier elevation language (page → card → floating-surface) and bind every primitive to one of those tiers. The current "everything is shadow-sm" reads flat.

9. **Iconography contract.** Lock the icon-size scale to 3 values (sm=12, md=14, lg=18, hero=24) and write an ESLint rule. The current 7-size sprawl gives the chrome a slightly-different-everywhere feel.

10. **A real KPI/Stat primitive.** `Stat` at `Stat.tsx:34-44` is a minimal stat block — label + value, four tones, that's it. The hero KPI block at `HeroOverview.tsx:650-707` (`FloatingKpi`) re-implements label + valuePrefix + value + chip + delta + accent + inverseDelta — none of that is in the primitive. Drawer stats (`CampaignDrawer DrawerStat`) re-implement again. Three implementations of "show a number with context." Build one.

---

## Prioritized recommendations

### P0 — must-fix for premium feel

1. **Delete the legacy palette block** at `tailwind.config.ts:67-114` (`background`, `surface*`, `primary.*`, `roas.*`, `text.*`). Migrate the ~10 known consumers (`BillingSettings`, `PnLBreakdown`, `CampaignsTableRow`, `layout.tsx:47`, the OAuth callback routes) to tokens. The dual-system schism is the #1 visual coherence problem and the CI gate already exists for hex-in-components — just needs a new gate for legacy Tailwind class names.

2. **Re-hue TikTok and Organic to remove status collisions.** Move TikTok from red 25° to rose/magenta 340°; move Organic from violet 305° to teal or indigo. Same operation on the `--annotation-*` block so launch/sale/creative don't collide with chart series. Audit table: 7 collisions documented above.

3. **Fix the dark-mode regressions:** scrollbar (`globals.css:262-269`), skeleton shimmer (`globals.css:312-322`), `::selection` (`globals.css:254-257`), `focus-visible` global ring (`globals.css:295`). Each needs a `[data-theme="dark"]` override. Also: replace the `dark:from-accent dark:via-accent/80 dark:to-accent/55` shortcut at `HeroOverview.tsx:273` with the documented `--gradient-hero-*` tokens.

4. **Stop using `border-line-subtle` as a structural border.** `TableBase.tsx:21,29` row separators are documented as decorative-only in dark mode but render the table's row structure. Replace with `border-line` everywhere structural; keep `border-line-subtle` only for actual ornamental divides.

5. **Build a `Typography` primitive** (`<Heading level>`, `<Text variant>`). Migrate the 5+ H2 patterns + caption/label/body class-stacks. This is the single biggest hierarchy lever.

6. **Define `--shadow-md`** (referenced at `globals.css:282` but undefined — Recharts tooltips currently have no shadow).

### P1 — should-fix

7. **Build a `PlatformBadge`** that renders icon + name + dot in a consistent visual treatment. Use everywhere the word "Meta"/"Google"/"TikTok"/"Shopify"/"Organic" appears in tables, drawers, tooltips.

8. **Replace emoji with Lucide icons** in `annotations.ts:50` (`ANNOTATION_KIND_EMOJI`), the `🏪`/`⏸`/`🏷️`/`⏳` chips in `CampaignsTableRow`, the trophy text everywhere. Emoji in a financial dashboard reads "side project."

9. **Build a unified `Stat` primitive** that subsumes `FloatingKpi` (hero), `DrawerStat` (drawer), and existing `Stat` (`Stat.tsx`). Variants: hero (giant numeral, no card), card (current Stat), drawer (medium with chip + accent + delta).

10. **Define a real spacing + motion scale** (`--space-1` through `--space-12`, `--motion-fast/base/slow`). Migrate the primitives off raw Tailwind class numbers.

11. **Collapse `format.ts:STORE_HUES` and `storeColors.ts:STORE_COLORS`** into one module with one fallback palette. Re-export the badge-hex helper from there.

12. **Lock icon size scale to 3 values** + lint rule. Currently 7 sizes in active use.

13. **Build dark-mode-aware shadow tokens.** Dark mode currently uses cool-tinted-navy shadows on a dark navy canvas — invisible. Either flip to black-based shadows in dark mode or replace card shadows entirely with elevation-borders in dark mode.

### P2 — nice-to-have

14. **Auto-attach `Card.Header/Body/Footer` as namespace exports** so the compound pattern is uniform with `InsightCard.Group/Row`.

15. **Build `Sheet.Header` / `Dialog.Header`** compound exports — currently every drawer hand-rolls the sticky header bar with logo + title + close.

16. **Tighten the `text-muted` color one step.** Light mode `oklch(60% 0.015 250)` is right at 4.0:1 on elevated surfaces — bump to L=52% for true 4.5:1 AA. Same in dark mode.

17. **Define a subtle gradient wash for icon backplates** (the `bg-accent/8` pattern in `SectionIntro.tsx:48`, `CampaignDrawer.tsx:803`). A two-stop gradient would lift these from "color swatch" to "premium accent."

18. **Replace the global `focus-visible` ring in `globals.css:293-297`** with a token-driven rule that uses `--accent` at 30% opacity. Eliminates the double-ring artifact on primitives.

19. **Add a `--surface-elevated-3`** for nested-card scenarios (e.g., chart-inside-card patterns). Currently consumers fall back to `bg-elevated` with a tinted border, which doesn't read as deeper elevation.

20. **Tabular-nums + Hebrew safety primitive.** A `<Num>` component that auto-wraps in `<bdi dir="ltr">`, applies `tabular-nums`, and accepts a tone for delta highlighting. Replaces the 38 hand-rolled `<bdi dir="ltr">` instances scattered through the codebase.

---

## Closing assessment

The token foundation is unusually thoughtful for an internal tool — OKLCH math, light/dark hotfix history, CI gates against hex/dark-variant/raw-button, documented WCAG decisions. That's all real work and it shows.

The execution layer hasn't caught up to the foundation. A dual color system, 5+ heading styles, emoji-and-lucide mix, a focused tooltip with no shadow, a hero gradient that bypasses its own tokens in dark mode, platform-color identity that exists only in charts, status-red that is also TikTok-red — these are the gaps. None are hard to close individually; they're a backlog of ~15-20 small fixes plus three larger primitives (`Typography`, `PlatformBadge`, unified `Stat`).

The path to a Linear/Stripe/PostHog feel is not a redesign — it's deletion of the legacy palette + three new primitives + dark-mode polish on five specific surfaces.

# Tooltip System Redesign — Research & Design Direction (2026-06-03)

## 1. Executive summary

The dashboard has **one sanctioned tooltip primitive** (`HelpTooltip`, a Radix `@radix-ui/react-tooltip` wrapper) used across ~32 files, plus a **separate, already-consistent Recharts `ChartTooltip` family**, plus **four hand-rolled hover-popovers** outside any primitive, plus **a long tail of native `title=` leftovers** that slip past the lint rule by sitting on the prop-forwarding `<Button>` component. The system is **broken on touch** (Radix Tooltip does not open on tap, so every `HelpTooltip` is invisible on phones), **partially clipped** (three of the four bespoke popovers are not portalled and get cut off inside `overflow-auto` tables), and **a11y-incomplete** (no uniform Esc/hoverable assertions, a latent ARIA anti-pattern where rich `ReactNode` content sits inside `role="tooltip"`, one multiline `\n` that never line-breaks).

The redesign keeps **exactly one entry point** (`HelpTooltip`, same signature, same null-passthrough contract — so all consumers upgrade for free) and **introduces no new visual style**. Internally the primitive auto-selects one of **four render modes** on the axes *pointer type × content shape*: simple/desktop = **Radix Tooltip** (`role="tooltip"`), rich/desktop = **Radix Popover** (`role="dialog"`), simple/touch = **toggletip** (ⓘ-button → tap-open Popover), rich/touch = **bottom Sheet**. All four wear the existing mesh/glass token skin. The native-`title=` ban is hardened so the `<Button>` bypass can no longer return, and CI gains a touch-emulation test, a keyboard test, and a "no focusable element inside `role=tooltip`" guard so the accessibility guarantee is hermetic. One deploy, not drip.

## 2. Best-practices synthesis

### 2.1 The tooltip-vs-popover decision rule (universal)

| Need | Vessel | ARIA | Trigger |
|---|---|---|---|
| Short, passive, non-interactive label/help (≤~15 words, 1–2 lines) | **Tooltip** | `role="tooltip"` + `aria-describedby` on trigger | hover OR focus |
| Title + body, multi-paragraph, table, structured rows | **Popover / Rich tooltip** | `role="dialog"`, focus-managed | click/tap (or hover-intent) |
| Any link / button / input / "stay-open-to-interact" | **Popover / non-modal Dialog** (never a tooltip) | `role="dialog"` | click/tap |

The hard rule every system enforces (W3C ARIA APG, Radix, Material 3, Atlassian, Stripe, Geist): **a tooltip never receives focus and is not in the tab order, so it must not contain focusable content.** The moment you need interactivity or a heading+body+action, you promote to a Popover/Dialog. This is a correctness rule, not a style preference.

### 2.2 Desktop behavior — WCAG 2.1 SC 1.4.13 "Content on Hover or Focus" (AA)

| Property | Requirement | Implementation |
|---|---|---|
| **Dismissible** | Esc closes without moving pointer/focus | wire `onEscapeKeyDown` |
| **Hoverable** | pointer can travel onto the bubble without it vanishing | do NOT set `disableHoverableContent`; small `sideOffset`; ~150ms close-delay |
| **Persistent** | stays until trigger removed / dismissed / info invalid | no hard auto-dismiss timer while hover/focus is active (so we reject Material's 1500ms auto-hide) |

Plus: open on keyboard **focus** (instant), not hover-only; `tabindex=0` on non-focusable triggers; `role="tooltip"` on the bubble with `aria-describedby` on the **trigger** (not the bubble); abandon the native `title=` attribute (inconsistent AT announcement, no keyboard access, unstyleable).

### 2.3 Mobile behavior — touch has no hover

| Anti-pattern | Fix |
|---|---|
| Retrofit a hover tooltip onto touch | **Don't.** Use a **toggletip** (tap-driven) — a different component with different ARIA |
| "First tap reveals, second tap acts" double-tap trap | **Separate** the reveal affordance (a dedicated ⓘ `<button>`) from any action control |
| `aria-describedby` on a toggletip | use a **`role="status"` live region** — announce on tap, not before |
| Cram rich content into a phone-width bubble | escalate to a **bottom sheet** with a **visible close (X)** button (a drag handle alone is an a11y failure — NN/g) |
| Tiny tap target | **≥44×44pt (Apple) / 48dp (Material) / 24px CSS AA floor (WCAG 2.5.8)** |

### 2.4 Craft values (cross-system convergence)

| Aspect | Consensus | Sources |
|---|---|---|
| Show delay (hover) | ~150–500ms (Material 500ms; Floating UI delay-group 200ms); **0ms on focus** | Material, Floating UI, Setproduct |
| Close delay | ~100–300ms so cursor can bridge the gap (supports Hoverable) | Floating UI |
| Delay groups | shared "skip delay" so the 2nd clustered tooltip opens instantly | Radix `skipDelayDuration`, Floating UI `FloatingDelayGroup` |
| Max-width | ~200–250px, 1–2 lines | Setproduct, NN/g, USWDS |
| Type | ~14px, AA contrast both themes | Setproduct |
| Radius | 4–8px (shadcn/Geist 6px) | shadcn, Geist |
| Shadow | subtle elevation, not a heavy modal shadow | Setproduct |
| Arrow | recommended — binds bubble to trigger, re-anchors after flip | NN/g, Setproduct |
| Positioning | `offset` + `flip` + `shift` + `collisionPadding` + autoUpdate | Floating UI, USWDS |
| Motion | fade 150–200ms + 2–4px slide from transform-origin; respect `prefers-reduced-motion` | Setproduct, Geist |
| Never | hide task-critical info behind hover; repeat the trigger label | NN/g, USWDS, Atlassian |

**Primary sources:** W3C WCAG 2.2 Understanding SC 1.4.13; W3C ARIA APG Tooltip Pattern; Floating UI docs (tooltip/popover); USWDS Tooltip; Material 3 Tooltips (plain vs rich); NN/g (tooltip guidelines, bottom sheets); Apple HIG Popovers; Heydon Pickering *Inclusive Components* (Tooltips & Toggletips); Sarah Higley *Tooltips in the time of WCAG 2.1*; Atlassian, Stripe Apps, Vercel Geist, Radix Primitives docs + issues #2589/#1573/#2278/#955, discussion #2866.

## 3. Current state

### 3.1 The primitive

`dashboard-web/src/components/ui/Tooltip.tsx` — thin Radix `@radix-ui/react-tooltip` v1.2.8 wrapper. Exports `TooltipProvider/Tooltip/TooltipTrigger/TooltipContent` + the convenience `HelpTooltip`.

```tsx
HelpTooltip({ content, children, side, align, sideOffset, className, delayDuration = 300 })
```

Content chrome: `z-50 max-w-xs rounded-md bg-glass-2 text-ink border border-glass-edge shadow-overlay px-2.5 py-1.5 text-2xs` + `animate-in fade-in-0 zoom-in-95`. Portalled. Returns the child untouched when `content` is `null`/`''`/`undefined` (load-bearing contract). App-root `TooltipProvider` sets `delayDuration` + `skipDelayDuration=150` (`layout.tsx:89`).

| Gap | Detail |
|---|---|
| Touch | Radix Tooltip has no tap-to-open → all ~32 consumers invisible on phones; tap on interactive triggers fires the action |
| A11y | no explicit Esc/hoverable assertions; rich `ReactNode` inside `role="tooltip"` is an ARIA anti-pattern |
| Positioning | no `collisionPadding`, no `avoidCollisions`/`sticky` → edge clipping in scroll tables |
| Style | legacy `rounded-md` (should be semantic `rounded-chip`); `text-2xs` (0.6875rem) too small; **no arrow**; z-50 collides with the Sheet/drawer layer |

### 3.2 Full tooltip inventory

| Family | Where | Content | Touch | Portal | Verdict |
|---|---|---|---|---|---|
| **A. `HelpTooltip` (Radix)** | ~32 files, ~76 call-sites | mostly SIMPLE; a minority RICH (see §5) | ✗ none | ✓ | extend in place |
| **B. `ChartTooltip` (Recharts)** | 4 charts: `RoasChart:115`, `CampaignsTable:1717`, `CampaignDrawerDaily:140/345`, `MetaShopifyReconciliation:672` | RICH multi-row | ✓ cursor-drag | n/a | **leave as-is** (already token-correct skin reference) |
| **C. Bespoke hover-popovers** | `RefundIndicator` (gold standard: portal+flip+`isTouchDevice`), `ProductCentricView` `HoverTooltip`×1 + `ColHelp`×9 (not portalled), `CampaignsTable` `ColumnHeaderTh`×4 (TODO mobile-clip `:2616`), `RoasTargetChart` pin+crosshair, `CustomerValueCurve` LTV hover | RICH | inconsistent (only RefundIndicator) | only RefundIndicator | fold into primitive / retrofit chrome |
| **D. Native `title=` leftovers** | see below | SIMPLE | OS-chrome only | n/a | migrate; harden lint |

**Native `title=` leftovers** (evade lint via the PascalCase early-return at `no-native-title-tooltip.js:57` because `<Button>` spreads `{...props}` to the DOM — `Button.tsx:46`): `GoalTracker:231/244/400/523`, `HealthScoreBadge:83`, `TabFreshnessHeader:74`, `InsightsBoard:418/617/627/647`, `AdSetTable:174`, `CampaignsTableRow:262`. Plus one SVG `<title>` on `RoasTargetChart:778` data dots (lint-exempt, but a native hover tooltip duplicating the crosshair). *(Note: the original audit listed 7; there are more — the count above is the corrected superset.)*

## 4. The chosen unified design

### 4.1 The core decision

**One primitive file, three (four) render modes, auto-selected — never a new visual style.** `HelpTooltip` keeps its exact signature and null-passthrough. Internally it branches:

| | Simple text content | Rich content (`ReactNode` block / `variant="rich"` / multiline) |
|---|---|---|
| **Pointer: fine (desktop)** | **A. Radix Tooltip** (hover + focus), `role="tooltip"` | **B. Radix Popover** (wider, hover-intent or click), `role="dialog"` |
| **Pointer: coarse (touch)** | **C. Toggletip** = ⓘ-button → tap-open Radix Popover | **D. Bottom Sheet** (`Sheet side="bottom"`) |

Pointer type via `@media (hover: none) and (pointer: coarse)` (mirrored by `useIsMobile(767)` for the Sheet breakpoint, SSR-safe). Content shape: `string`/`number` → simple; non-string `ReactNode` OR explicit `variant="rich"` → rich. The selector is internal — call-sites never think about it.

### 4.2 Graphic language — existing tokens only, light + dark first-class

**No new CSS variables.** Reuse the blessed surfaces (`globals.css` line refs in parens).

| Aspect | Token / value | Source |
|---|---|---|
| Surface (simple) | `bg-glass-2` (`#1d2138` dark / `#f6f7fb` light) | globals.css 228/569 |
| Surface (rich) | `bg-glass-1/95` + `backdrop-blur-sm` (`var(--blur-glass)`) — mirrors `ChartTooltip` | ChartTooltip.tsx 30–31 |
| Rim | `border border-glass-edge` | confirmed |
| Ink | `text-ink` body; `text-ink-secondary` labels; `text-ink-muted` timestamps/captions | ChartTooltip 49/73 |
| Shadow | `shadow-overlay` (the one shadow tagged "tooltips, popovers, dropdown menus") | globals.css 272/278/603 |
| Radius | `rounded-md` → **`rounded-chip`** (simple) / **`rounded-card`** (rich) | tailwind semantic radii |
| Padding | simple `px-2.5 py-1.5`; rich `px-3 py-2` (match `ChartTooltip`) | confirmed |
| Type | simple `text-2xs` → **`text-xs`** (legibility); rich body `text-xs`, optional title `text-sm font-semibold text-ink` | primitive stream |
| Numbers | every value via `<Money>`/`<Metric>`, wrapped `<bdi dir="ltr">` `font-mono tabular-nums` (the `ChartTooltipValue` pattern) — never clip | ChartTooltip 88–90 + repo rule |
| Arrow | **ADD** `RadixTooltip.Arrow` / `Popover.Arrow`, `fill-glass-2` (simple) / `fill-glass-1` (rich), `width:10 height:5` | best-practices |
| Max-width | simple `max-w-xs` (20rem); rich `max-w-sm` (24rem) desktop; sheet = full-width | confirmed |
| Motion | `animate-in fade-in-0 zoom-in-95` off `data-state` + `--radix-*-transform-origin`; `duration-fast`/`ease-out`; slide/zoom gated behind `prefers-reduced-motion` → fade-only | confirmed |
| Direction | `dir="rtl"` container, numbers in `<bdi dir="ltr">` (RTL primary; Radix resolves logical side/align under `dir`) | ChartTooltip 28 |
| z-index | `z-50`; **lift to `z-[60]` when opened inside a drawer** (`withinDrawer`; precedent Sheet.tsx:133–138) | primitive stream |

**Contrast guarantee:** ink-on-glass-2 already clears AA in both themes (`contrastGuard.test.ts`). The size bump and new surfaces inherit this; no text color ever derives from a brand/band color. Add the new surfaces to the existing contrast guard so they ratchet.

### 4.3 Desktop behavior

- **Simple (mode A):** open on hover after ~200–300ms (`delayDuration=300`) AND instantly on focus. Keep app-root `TooltipProvider skipDelayGroup` (`skipDelayDuration=150`) for clustered icons. Esc closes (`onEscapeKeyDown`). Hoverable (no `disableHoverableContent`, `sideOffset=6`, ~150ms close-delay). Persistent (no auto-dismiss while active). `avoidCollisions` + **add `collisionPadding={8}`** + flip + arrow re-anchor; stays portalled to body. Radix supplies `role="tooltip"` + `aria-describedby`; non-focusable triggers get `tabindex=0`.
- **Rich (mode B — Radix Popover, `role="dialog"`):** hover-intent-or-click open, `max-w-sm rounded-card`, focus-managed, explicit Esc + click-outside, `whitespace-pre-line` (fixes the `CampaignDrawerOverview:354` `\n` bug). Numbers via `<Money>`.

### 4.4 Mobile behavior (mandatory + simple)

- On coarse pointers the trigger renders/pairs a dedicated **ⓘ info `<button>`** — 24px glyph in a **≥44px hit area**. This kills the double-tap trap by separating reveal from action.
- **Single tap opens** a Radix Popover (mode C); **tap-outside (scrim) or Esc closes.** No long-press, no hover emulation.
- Announce via **`role="status"` live region** on open (NOT `aria-describedby`).
- **No interactive content inside** the bubble.
- **Rich content (mode D)** escalates to the existing **`Sheet side="bottom"`** (`max-sm:inset-0`, `bg-scrim` overlay, focus-trap, Esc/click-outside from Radix Dialog) with a **visible Close (X)** button. This is where the LTV-curve explanation, attribution breakdown, cohort verdict, and refund breakdown live on a phone.
- Operator simplicity: one consistent ⓘ everywhere on touch, one consistent "tap-out / X to close."

### 4.5 The primitive API

```tsx
HelpTooltip({
  content,                    // ReactNode | null | undefined  (unchanged; null → child untouched)
  children,                   // trigger, via Trigger asChild   (unchanged)
  side, align, sideOffset,    // unchanged pass-throughs
  className, delayDuration,   // unchanged
  // NEW — all optional, backward-compatible:
  variant?: 'auto' | 'text' | 'rich',  // default 'auto': string→text, ReactNode-block→rich
  title?: ReactNode,          // rich-only headline (text-sm font-semibold)
  withinDrawer?: boolean,     // lift to z-[60] when opened inside a Sheet/drawer
})
```

`variant='auto'` (default): plain string/number → mode A/C; non-string `ReactNode` or explicit `rich` → mode B/D. Internally the rich path mounts Radix **Popover** (`role="dialog"`); the simple path mounts Radix **Tooltip** (`role="tooltip"`). **One public component, two correct ARIA trees** — do not add a `rich` boolean to the *same* render tree as a flag that fakes a dialog. `ChartTooltip` stays a separate family (Recharts touch via cursor-drag); just keep the skins aligned.

## 5. Simple-vs-rich split + per-type adaptations

| Type | Desktop | Mobile | Sites |
|---|---|---|---|
| **SIMPLE** (~90%) — truncated names, status labels, ISO timestamps, %-helps, "open in Ads Manager", coverage/freshness chips, KPI one-liners, CBO/ABO/paused/unmapped flags | mode A slim glass-2 bubble (size bump + arrow + a11y, no layout change) | mode C toggletip | `FirstClickCoverageChip`, `CoverageChip` short clauses, `CampaignFreshnessChip`, `FreshnessChip`, `StatusPill`, most `CampaignsTableRow`/`AdSetTable`/`AdsDrawer`/`ProductsTable` |
| **RICH — LTV curve** (~400-char Hebrew paragraph, the longest tooltip) | mode B popover | **mode D sheet (mandatory)** | `CustomerValueTab:357` |
| **RICH — attribution / first-click explainers** | mode B | mode D | `CoverageChip`, `CampaignsTableRow:613/668/706` |
| **RICH — column-header help paragraphs** (×13) | mode B | mode D | `ProductCentricView` `ColHelp`×9, `CampaignsTable` `ColumnHeaderTh`×4 |
| **RICH — refund breakdown** (2-line) | mode B | mode D | `RefundIndicator` |
| **RICH — cohort verdict** (4-branch) | mode B | mode D | `CohortComparisonPanel:398` |
| **RICH — multiline mapped-id** (`\n`) | mode B + `whitespace-pre-line` | mode D | `CampaignDrawerOverview:354` (fixes the no-break bug) |
| **RICH — SVG-anchored** (follows cursor over SVG) | **stay bespoke/pointer-anchored**, adopt shared rich-card chrome + mobile tap/dismiss + `role` ARIA + `<Money>` | tap/dismiss | `RoasTargetChart` pins+crosshair, `CustomerValueCurve` LTV hover |

**Promotion rule:** heading, >~2 sentences, a table, or structured rows ⇒ rich. Anything with a link/button/input ⇒ it was never a tooltip; it's a Popover/Sheet.

## 6. Migration map + rollout

| Phase | Scope | Detail |
|---|---|---|
| **0 — harden the guard (first)** | `eslint-rules/no-native-title-tooltip.js` | Add an allowlist so `title=` on prop-forwarding primitives (`Button`, anything that spreads `{...props}` to a host element — `Button.tsx:46`) is **flagged** (close the line-57 PascalCase bypass). Add a CI guard that fails if a `role="tooltip"` subtree contains a focusable element (`a/button/input/[tabindex]`). |
| **1 — upgrade the one primitive** | `Tooltip.tsx`, no call-site changes | Four modes, arrow, `collisionPadding={8}`, `text-xs`, `rounded-chip`, Esc/hoverable assertions, touch toggletip + bottom-sheet, `role="status"` live region, `withinDrawer` z-lift. All ~32 `HelpTooltip` files inherit it. Add a **Playwright mobile-emulation test** (coarse pointer → tap ⓘ → popover/sheet opens → tap-out closes) + a **keyboard test** (focus → appears → Esc → gone, focus unchanged). |
| **2 — convert native `title=` leftovers** | `GoalTracker:231/244/400/523`, `HealthScoreBadge:83`, `TabFreshnessHeader:74`, `InsightsBoard:418/617/627/647`, `AdSetTable:174`, `CampaignsTableRow:262` | Wrap in `HelpTooltip`, or drop to `aria-label`-only where the text merely repeats an action label that already has one (optimize-toggles). Remove `RoasTargetChart:778` SVG `<title>` on data dots (the crosshair already covers them → double tooltip). |
| **3 — fold the 4 bespoke hover-popovers in** | the real inconsistency | `RefundIndicator` → rich mode (delete its touch logic). `ProductCentricView` `HoverTooltip`×1 + `ColHelp`×9 → rich (currently not portalled → clipped). `CampaignsTable` `ColumnHeaderTh`×4 → rich (closes its `:2616` "TODO mobile-fix: clipped by overflow-auto" ). |
| **4 — chart-anchored** | `RoasTargetChart` pins+crosshair, `CustomerValueCurve` LTV hover | Keep bespoke positioning; retrofit shared rich-card chrome + mobile tap/dismiss + `role` ARIA + `<Money>`. **Leave Recharts `ChartTooltip` alone.** |

**One deploy, not drip** (per the repo's no-drip-deploy rule): land Phases 0–4 together, verify every tab in both themes + mobile emulation locally, then a single push.

### Relevant files

| File | Action |
|---|---|
| `dashboard-web/src/components/ui/Tooltip.tsx` | extend (the single entry point) |
| `dashboard-web/src/components/ui/chart/ChartTooltip.tsx` | skin reference — leave as-is |
| `dashboard-web/src/components/ui/Sheet.tsx` | `side="bottom"` mobile rich vessel |
| `dashboard-web/src/lib/hooks/useIsMobile.ts` | breakpoint (767, SSR-safe) |
| `dashboard-web/eslint-rules/no-native-title-tooltip.js` | line 57 — harden the PascalCase bypass |
| `dashboard-web/src/app/globals.css` | tokens: `--shadow-overlay` 278/603, `--glass-1/2` 227–228/568–569, `--blur-glass` 264 |
| `dashboard-web/src/app/layout.tsx:89` | global delay/skip-delay provider |
| `dashboard-web/src/components/ui/Button.tsx:46` | prop-forwarding the lint must cover |

## 6.5 Decisions LOCKED (operator, 2026-06-03 — mockup approved)

The mockup at `docs/superpowers/mockups/2026-06-03-tooltips/tooltip-system-mockup.html` was approved (light+dark, desktop+mobile, simple+rich). The seven design pillars stand. The six open questions below are resolved:

1. **Desktop rich open trigger** → **hover-intent** (open on hover after a short intent delay) on desktop, tap on touch.
2. **Bottom-sheet threshold** → escalate to a bottom sheet on touch **only for long rich content** (content height would exceed ~40% viewport — LTV curve, attribution explainers, column-header paragraphs). Short rich items (refund 2-liner, cohort verdict) stay a **tap-open Popover** on touch.
3. **ⓘ affordance density** → **ⓘ everywhere** for consistency (including dense table cells).
4. **`RoasTargetChart` SVG `<title>`** → **remove** the duplicate `<title>` on data dots (the crosshair tooltip already covers them).
5. **`skipDelayDuration`** → **tune**: `delayDuration=200ms` (open), `skipDelayDuration=300ms` (skip-group window) so clustered table-header help icons open instantly when traversed. Final values to be confirmed during the visual-verification sweep.
6. **Optimize-toggle labels** → **drop to `aria-label`-only** where the `title=` merely repeats the action label (no visible tooltip).

## 7. Open questions for the operator (RESOLVED — see §6.5)

1. **Desktop rich open trigger** — hover-intent (consistent with simple) or click-only (clearer, matches popover convention)? Hover-intent is friendlier on a mouse-heavy internal tool; click-only is more predictable. Default proposal: hover-intent on desktop, tap on touch.
2. **Bottom-sheet threshold** — should *every* rich tooltip become a bottom sheet on phones, or only the genuinely long ones (LTV curve, attribution)? Short rich items (refund 2-liner, cohort verdict) could stay a tap-open popover even on touch. Proposal: sheet only when content height would exceed ~40% viewport.
3. **ⓘ affordance density** — adding a visible ⓘ button next to every simple help on touch could clutter dense tables. Acceptable everywhere, or suppress on table-cell triggers (long-press fallback there despite the discoverability cost)? Proposal: ⓘ everywhere for consistency.
4. **`RoasTargetChart` SVG `<title>` on dots** — confirm removal (the crosshair tooltip already covers those points on hover). Proposal: remove.
5. **`skipDelayDuration`** — keep at 150ms, or tune now that arrows + collision padding change the feel of clustered table-header tooltips?
6. **Optimize-toggle labels** — for the `AdSetTable`/`CampaignsTableRow` optimize toggles whose `title=` merely repeats the `aria-label`, drop to `aria-label`-only (no visible tooltip) or keep a real `HelpTooltip`? Proposal: `aria-label`-only (the text is redundant).

# Chart line colors — brand-true palette + dark-mode contrast sweep

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Revision:** v2 — scope widened from "dark-only contrast tweak" to "rebrand categorical palette to match true platform identities + brighten dark mode + reslot store colors into non-platform hue space".

## Predecessor context

Hotfix-12 (`414e2d2`) moved chart axis / grid / cursor / target colors to theme-aware CSS vars but kept categorical series colors (per-store + per-platform) as raw hex literals, citing the "brand identity" rule. Operator subsequently confirmed two distinct problems:

1. **Brand mismatch.** Current Meta=amber, Google=blue is backwards — Meta is famously blue (`#1877F2` brand), Google's identity palette has amber/yellow front and center. TikTok at slate-700 (`#374151`) reads as "no data" rather than a brand color; TikTok's actual brand is a neon red/magenta. Operator selected the palette: Meta→blue, Google→amber, TikTok→neon red, Organic→lighter purple, Shopify→brighter green.
2. **Dark-mode contrast.** The `uzoshop` store line (`#1c4587` navy, OKLCH ~30% L) sits at ~1.5:1 contrast against the dark canvas. Same applies to the KpiCards "neutral" sparkline (same navy via a different code path).

The Zol Plus amber color also conflicts with the new Google amber under the platform swap. The store palette is re-slotted into the three hue gaps the platforms leave open: cyan, hot-pink/magenta, and lime/yellow-green.

## Goals

1. Categorical chart line colors look correct for the brand each one represents — in both light and dark mode.
2. Every chart line clears WCAG AA Large contrast against the active canvas (target stroke widths are ≥2px throughout the codebase).
3. Per-store identity colors don't echo any platform identity color — they sit in their own hue family.

## Non-goals

- Touching the HeroOverview hero gradient (white-on-accent), refund-day amber ring, ROAS status bg/fg cell tokens, or any non-line color.
- ROAS status color logic (`roasLabel`) — color thresholds for red/orange/green/blue stay exactly as documented.
- HeroOverview annotation rail colors (`ANNOTATION_KIND_COLOR`) — separate semantic family.
- FALLBACK_PALETTE for unknown stores (5 unused fallback hex values — only triggers if a 4th store is added).

## Design

### 1. Final palette (light + dark)

#### Platforms — brand-true

| Channel | Light hex | Dark OKLCH | Notes |
|---|---|---|---|
| **Meta** | `#2563eb` (blue-600) | `oklch(70% 0.18 260)` | brand-correct |
| **Google** | `#d97706` (amber-600) | `oklch(75% 0.16 60)` | brand-correct (yellow side) |
| **TikTok** | `#ef4444` (red-500) | `oklch(72% 0.22 25)` | neon red — TikTok brand-ish |
| **Organic** | `#a855f7` (purple-500) | `oklch(75% 0.18 305)` | lighter than current `#9333ea` |
| **Shopify** | `#10b981` (emerald-500) | `oklch(75% 0.18 155)` | brighter than current `#15803d` |

#### Stores — non-platform hue space

| Store | Light hex | Dark OKLCH |
|---|---|---|
| **uzoshop** | `#06b6d4` (cyan-500) | `oklch(75% 0.13 200)` |
| **Zol Plus** | `#ec4899` (pink-500) | `oklch(72% 0.20 340)` |
| **360usmile** | `#84cc16` (lime-500) | `oklch(78% 0.20 130)` |

Hue map: cyan 200° ↔ pink 340° ↔ lime 130° — every store ≥ 140° apart on the wheel and ≥ 30° away from every platform color. Cyan stays clear of Meta blue (260°, 60° gap); pink stays clear of organic purple (305°, 35° gap — narrowest); lime stays clear of Google amber (60°, 70° gap) and Shopify green (155°, 25° gap — sharpest neighbour, but the platform/store distinction is also a brand-vs-store semantic cue).

### 2. Colorblind contract — intentionally narrowed

The header comment in [chartColors.ts](dashboard-web/src/lib/chartColors.ts) currently codifies a guarantee from audit-2026-05-23-v2 that TikTok must stay outside the magenta/purple hue family for protanopia/deuteranopia separation from Organic. This revision **intentionally retires that guarantee** — TikTok moves to neon red, which sits ~50° from Google amber and is a known red-green confusion hue pair. The operator has accepted the trade-off (brand identity > colorblind hue safety).

The two surviving disambiguation channels:

1. **Stroke pattern** (Shopify dashed 6-3, Meta solid) — already in place per existing RoasChart spec. Extending the pattern to TikTok is deferred (see Out of Scope) — implementation phase only adds it if visual review shows a real collision.
2. **Legend swatch labels** — every chart has a visible legend, so even total hue collapse still leaves the label as a fallback identifier.

The comment in `chartColors.ts` is rewritten to document the new contract: "Hue families are now BRAND-true; colorblind disambiguation relies on stroke pattern + legend, not on hue separation."

### 3. Token surface — `globals.css`

Add three groups of `--chart-*` vars under `:root` and override under `[data-theme="dark"]`.

```css
:root {
  /* per-platform identity */
  --chart-platform-meta:     #2563eb;
  --chart-platform-google:   #d97706;
  --chart-platform-tiktok:   #ef4444;
  --chart-platform-organic:  #a855f7;
  --chart-platform-shopify:  #10b981;

  /* per-store identity */
  --chart-store-uzoshop:  #06b6d4;
  --chart-store-zolplus:  #ec4899;
  --chart-store-usmile:   #84cc16;
}

[data-theme="dark"] {
  --chart-platform-meta:     oklch(70% 0.18 260);
  --chart-platform-google:   oklch(75% 0.16 60);
  --chart-platform-tiktok:   oklch(72% 0.22 25);
  --chart-platform-organic:  oklch(75% 0.18 305);
  --chart-platform-shopify:  oklch(75% 0.18 155);

  --chart-store-uzoshop:  oklch(75% 0.13 200);
  --chart-store-zolplus:  oklch(72% 0.20 340);
  --chart-store-usmile:   oklch(78% 0.20 130);
}
```

### 4. KpiCards sparkline — collapse to existing tokens

Per [KpiCards.tsx:271-273](dashboard-web/src/components/KpiCards.tsx#L271-L273):

```tsx
// Current
const sparkColor =
  accent === 'pos' ? 'rgb(21, 128, 61)'
  : accent === 'neg' ? 'rgb(220, 38, 38)'
  : 'rgb(13, 54, 128)';

// After
const sparkColor =
  accent === 'pos' ? 'var(--status-green)'
  : accent === 'neg' ? 'var(--status-red)'
  : 'var(--accent)';
```

No new `--chart-spark-*` vars needed. The sparkline shows aggregate dashboard trend, not platform/store identity — `--accent` is semantically correct (it's the dashboard's primary cue) and it already shifts brighter in dark mode (light `oklch(55% 0.18 260)` → dark `oklch(65% 0.16 260)` per existing globals.css).

### 5. Consumers — hex → `var()`

| File | Change |
|---|---|
| `dashboard-web/src/lib/storeColors.ts` | `STORE_COLORS` map values become `'var(--chart-store-uzoshop)'` / `'var(--chart-store-zolplus)'` / `'var(--chart-store-usmile)'`. `FALLBACK_PALETTE` stays hex (unknown-store edge case). |
| `dashboard-web/src/lib/chartColors.ts` | (a) `CHART_COLORS.{meta,google,tiktok,organic,shopify}` → vars; (b) bonus cleanup: `cpm` → `var(--status-orange)`, `cpmPrev` → keep `#fbbf24` (light amber comparator), `roas`/`value` → `var(--status-green)`, `spend` → `var(--status-red)` — these are statuses, not identities; (c) rewrite header comment to document the new "hue families are brand-true; colorblind handled by stroke pattern + legend" contract. |
| `dashboard-web/src/components/KpiCards.tsx` (lines 271-273) | `sparkColor` switch returns `var(--status-green)` / `var(--status-red)` / `var(--accent)` strings. |
| `dashboard-web/src/components/HeroOverview.tsx` | NO CHANGE — uses white-on-accent gradient, not categorical line colors. |

### 6. Runtime correctness

- Recharts `stroke=` accepts CSS var strings (proven by hotfix-12 for axis/grid).
- SVG `fill=` accepts CSS var strings (same proof).
- All new vars cascade from `:root`, so no per-instance `ChartContainer` plumbing is needed.

### 7. Tests

- **`storeColors.test.ts`**:
  - Replace hex-pattern regex on line 20 (`/^#[0-9a-fA-F]{6}$/`) with `/^var\(--chart-store-/`.
  - Update lines 33-43 hex-equality assertions: `expect(STORE_COLORS.uzoshop).toBe('var(--chart-store-uzoshop)')` (and siblings — Zol Plus, 360usmile).
  - Update the docstring comments on those tests ("uzoshop is navy" → "uzoshop is cyan", etc.) to match the new palette.
  - Preserve the unknown-store fallback test as-is (FALLBACK_PALETTE stays hex).
- **`chartColors.test.ts`**:
  - Update categorical assertions to `'var(--chart-platform-*)'` strings.
  - **Remove** the anti-pink-regression check on TikTok (line 31: `expect(CHART_COLORS.tiktok).not.toBe('#ec4899')`) — `#ec4899` is now the legitimate Zol Plus store color, and TikTok's hue contract is brand-true rather than anti-pink.
  - Add a positive identity assertion: `expect(CHART_COLORS.tiktok).toBe('var(--chart-platform-tiktok)')`.
  - Update `meta`/`google` assertions to reflect the swap (Meta is now blue, Google is now amber).
  - Update `cpm`/`roas`/`value`/`spend` assertions to status-token vars.
  - Keep the existing `cpmPrev: '#fbbf24'` assertion (it stayed hex).
- **NEW `globals.css` parity test** at `dashboard-web/src/app/__tests__/globals-chart-vars.test.ts`:
  - Read `src/app/globals.css` from disk.
  - Parse `:root { ... }` and `[data-theme="dark"] { ... }` blocks.
  - Assert every `--chart-*` declared in `:root` is also declared in `[data-theme="dark"]`.
  - Guards against half-migrations (e.g., someone adds a new chart var but forgets the dark override).

### 8. Verification gate

- `npm run test` — all 1,347 tests still pass + 1 new test (1,348 total).
- `npm run typecheck` — clean.
- `npm run build` — clean.
- Visual (production after deploy — per [[feedback-no-localhost-checks]]):
  - Light mode: open Dashboard, screenshot RoasChart + Hero KPI sparklines + CampaignsTable row sparkline + CampaignDrawer charts. Verify Meta lines are now blue (not amber), Google lines are now amber (not blue), TikTok is a vivid red (not slate-gray), organic is a brighter purple, Shopify is a brighter green. Verify store lines are now cyan / pink / lime — and clearly distinct from any platform line on the same chart.
  - Dark mode: toggle and re-screenshot. Verify every line clears the 5:1 visual threshold against the dark canvas; uzoshop is no longer the near-invisible dark navy.

### 9. Docs

- **User Manual** bump 2.1.12 → **2.1.13**. Hebrew changelog: "Chart line colors have been updated to match brand identities (Meta blue, Google amber, TikTok red, etc.) and to be clearly readable in dark mode. Per-store line colors moved to cyan/pink/lime so they no longer overlap with any platform color."
- **No Architecture Doc change** — code shape and data pipeline unchanged; pure visual token plumbing.

## Risks

| Risk | Mitigation |
|---|---|
| Visual whiplash — operator + clients have built mental shortcut "blue = Google" over months of usage. Now it's Meta. | Spec is approved by operator; the whole point IS the rebrand. Single-day rip-and-replace, no toggle, no gradual migration. |
| Red-green confusion (TikTok red ↔ Shopify green ↔ Google amber are all warm hues on the wheel) | Stroke pattern channel (Shopify dashed) survives; legend swatch labels survive. Operator has accepted the trade-off explicitly. |
| Pink (Zol Plus) ↔ purple (Organic) hue gap is only ~35° — colorblind users may collapse them | These appear on *different* charts (Zol Plus is a store on RoasChart; Organic is an attribution channel on CampaignsTable/Drawer). Cross-chart collision is low. |
| One categorical hex is referenced somewhere outside chart line context (legend dot, hover ring, etc.) and would benefit from staying hex | `git grep` each old hex literal before edits. Decide per-call whether each consumer wants the var (theme-shift) or a frozen hex (e.g., legend ink stamp). |
| Dark `--chart-platform-meta` (bright blue oklch 70%) is nearly the same hue as `--accent` (oklch 65%) and could blend on cards that share the gradient | Light-mode preview first; if collision is real, drop Meta dark chroma to `0.16` and shift hue 5° cooler. |

## File touchpoints (anticipated)

```
dashboard-web/src/app/globals.css                                +30 lines (light tokens + dark overrides)
dashboard-web/src/lib/storeColors.ts                             ~5 lines edited
dashboard-web/src/lib/chartColors.ts                             ~15 lines edited (+ header comment rewrite)
dashboard-web/src/components/KpiCards.tsx                        3 lines edited
dashboard-web/src/lib/__tests__/storeColors.test.ts              ~15 lines edited
dashboard-web/src/lib/__tests__/chartColors.test.ts              ~20 lines edited
dashboard-web/src/app/__tests__/globals-chart-vars.test.ts       NEW (~40 lines)
docs/user-manual/...                                             1 changelog entry + version bump
```

Estimated total: ~1.5 hours focused work + 20 min visual verification (production deploy + light/dark screenshots).

## Out of scope (deferred to Plan 7 or future hotfixes)

- Tooltip surface chrome (`globals.css:174` raw `rgba(13, 37, 61, 0.96)` literal) — separate Plan 7 carryover.
- HeroOverview hero gradient (intentionally accent-driven, not categorical).
- `ANNOTATION_KIND_COLOR` annotations rail in HeroOverview.
- FALLBACK_PALETTE re-tuning for hypothetical 4th store.
- Stroke-pattern extension to TikTok (if visual review shows collision with Meta blue, defer to a separate plan).

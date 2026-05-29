# Chart line colors — dark-mode contrast sweep

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Predecessor context:** Hotfix-12 (`414e2d2`) moved chart axis / grid / cursor / target / refund-ring colors to theme-aware CSS vars, but explicitly kept categorical series colors (per-store + per-platform) as raw hex literals citing the "brand identity" rule. Operator subsequently confirmed those categorical hex values are not loud enough in dark mode — the worst offender is the `uzoshop` store line (navy `#1c4587`, OKLCH ~30% L) which sits at ~1.5:1 contrast against the dark canvas (OKLCH ~15% L), failing WCAG. The `KpiCards` neutral-tone sparkline shares the same navy hex via a different code path.

## Goal

Restore line legibility on the dark canvas across every chart series — per-store identity lines (RoasChart, TodayLive, PerStoreCards), per-platform identity lines (CampaignsTable, CampaignDrawer, MetaShopifyReconciliation), and KPI-card sparklines — while leaving light-mode pixels byte-identical to today's output.

## Non-goals

- Re-tuning light-mode palette. Light stays exactly as it is today.
- Touching the HeroOverview hero gradient (white-on-accent), refund-day amber ring, ROAS status bg/fg cell tokens, or any non-line color.
- Re-tuning the colorblind-safety contract (TikTok stays the "non-magenta neutral" channel, Meta-vs-Shopify red-green pair stays disambiguated by dash pattern, not hue).

## Design

### 1. Token surface — `globals.css`

Add three groups of `--chart-*` variables to `:root` (light) and override under `[data-theme="dark"]`.

#### Light defaults (byte-identical to current code)

```css
:root {
  /* per-store identity */
  --chart-store-uzoshop:  #1c4587;
  --chart-store-zolplus:  #d97706;
  --chart-store-usmile:   #0d9488;

  /* per-platform identity */
  --chart-platform-meta:     #d97706;
  --chart-platform-google:   #2563eb;
  --chart-platform-tiktok:   #374151;
  --chart-platform-organic:  #9333ea;
  --chart-platform-shopify:  #15803d;

  /* KpiCards sparkline tones */
  --chart-spark-pos:     rgb(21, 128, 61);
  --chart-spark-neg:     rgb(220, 38, 38);
  --chart-spark-neutral: rgb(13, 54, 128);
}
```

#### Dark overrides — OKLCH-tuned, hue-preserved

All targets land in OKLCH L ~68-75% so they sit roughly 5:1 against the dark canvas (OKLCH 15% L) — passing WCAG AA Large for stroke widths ≥2px (which is the RoasChart spec).

```css
[data-theme="dark"] {
  --chart-store-uzoshop:  oklch(72% 0.15 260);  /* bright navy → bright blue */
  --chart-store-zolplus:  oklch(75% 0.16 60);   /* gentle amber bump */
  --chart-store-usmile:   oklch(72% 0.14 180);  /* brighter teal */

  --chart-platform-meta:     oklch(75% 0.16 60);
  --chart-platform-google:   oklch(70% 0.16 260);
  --chart-platform-tiktok:   oklch(72% 0.02 250);  /* lighter NEUTRAL gray — preserves "non-magenta" rule */
  --chart-platform-organic:  oklch(68% 0.20 305);
  --chart-platform-shopify:  oklch(72% 0.18 145);

  --chart-spark-pos:     oklch(72% 0.22 145);
  --chart-spark-neg:     oklch(72% 0.22 25);
  --chart-spark-neutral: oklch(70% 0.16 260);   /* matches uzoshop dark blue */
}
```

#### Colorblind contract preserved

The header comment in `chartColors.ts` documents two constraints — both stay intact:

1. **TikTok must NOT swing into the magenta/purple hue range.** Dark `oklch(72% 0.02 250)` keeps it as a chromatically-near-neutral lighter gray. Hue 250° at chroma 0.02 is perceptually achromatic.
2. **Meta amber vs Shopify green** is disambiguated via dash pattern (Shopify dashed 6-3, Meta solid), not hue. Dark values stay in their respective amber/green hue families; pattern still handles overlap for the ~8% red-green deficient cohort.

### 2. Consumers — hex → `var()`

Four touchpoints rewrite their literals to CSS-var strings:

| File | Change |
|---|---|
| `dashboard-web/src/lib/storeColors.ts` | `STORE_COLORS` values become `'var(--chart-store-uzoshop)'` etc. `FALLBACK_PALETTE` stays hex (fallback for unknown stores is an edge case; not worth dark-tuning). |
| `dashboard-web/src/lib/chartColors.ts` | `CHART_COLORS.{meta,google,tiktok,organic,shopify}` → vars. Bonus cleanup: `cpm` → `var(--status-orange)`, `cpmPrev` → keep `#fbbf24` (light amber comparator), `roas`/`value` → `var(--status-green)`, `spend` → `var(--status-red)`. These are *statuses*, not identities — they should have moved to status tokens in hotfix-12 anyway. Also revise the top-of-file header comment to document the dark-mode override layer (current comment claims categorical colors "should NOT theme-swap" — that contract is being intentionally narrowed to "hue stays, lightness shifts"). |
| `dashboard-web/src/components/KpiCards.tsx` line 271-273 | `sparkColor` switch returns CSS var strings. |
| `dashboard-web/src/components/HeroOverview.tsx` | NO CHANGE — its mini sparklines use white-on-accent gradient, not store colors. Verified during exploration. |

### 3. Runtime correctness

- Recharts `stroke=` accepts CSS var strings (proven by hotfix-12 for axis/grid).
- SVG `fill=` accepts CSS var strings (same proof).
- The DOM element setting the var must be an ancestor. `ChartContainer` already sets `--chart-grid/--chart-axis/--chart-cursor/--chart-target` on its wrapper; these new vars cascade from `:root` instead (they're not chart-instance-scoped), so no per-container plumbing is needed.

### 4. Tests

- **`storeColors.test.ts`**: (a) replace the hex-pattern regex on line 20 (`/^#[0-9a-fA-F]{6}$/`) with `/^var\(--chart-store-/`; (b) update lines 33-43 hex-equality assertions to `expect(STORE_COLORS.uzoshop).toBe('var(--chart-store-uzoshop)')` (and siblings); (c) preserve the unknown-store fallback test as-is (FALLBACK_PALETTE stays hex).
- **`chartColors.test.ts`**: update categorical assertions to var strings; keep `cpmPrev: '#fbbf24'` assertion (it stayed hex). Update header comment + the tiktok anti-regression check to "must NOT be the original `#ec4899` pink hex" *plus* a comment that the dark var is also constrained to chroma ≤ 0.05 (near-neutral) — the assertion stays string-equality on `'var(--chart-platform-tiktok)'`.
- **NEW `globals.css` parity test** at `dashboard-web/src/app/__tests__/globals-chart-vars.test.ts`: read `src/app/globals.css`, parse `:root { ... }` and `[data-theme="dark"] { ... }` blocks, assert every `--chart-*` declared in one is declared in the other. Guards against half-migrations.
- **No new component tests.** Recharts internals + CSS-var resolution can't be unit-tested without jsdom + computed-style hacks; runtime visual verification covers it.

### 5. Verification gate

- `npm run test` — all 1,347 tests still pass + 1 new test (1,348 total).
- `npm run typecheck` — clean.
- `npm run build` — clean.
- Visual: open dashboard in light mode → screenshot RoasChart + Hero KPI sparklines, diff against baseline (light must be pixel-identical or trivially so).
- Visual: toggle to dark mode → screenshot the same → uzoshop line clearly readable (no longer near-invisible).
- Visual: toggle to dark mode → screenshot CampaignsTable per-row sparkline + CampaignDrawer charts → all platform series readable, TikTok still neutral-gray (not colored).

### 6. Docs

- **User Manual bump 2.1.12 → 2.1.13.** Changelog line: "Chart line colors in dark mode now use a brighter palette. Light mode is unchanged." (Hebrew translation in the manual file itself.)
- **No Architecture Doc change.** Code shape and pipeline are unchanged — only color token plumbing.

## Risks

| Risk | Mitigation |
|---|---|
| `oklch()` browser support | Already used heavily in globals.css (surfaces, text, status). No new browser dependency. |
| One of the categorical hexes is referenced from a non-line context (legend dot, hover ring, etc.) and would benefit from staying hex | `git grep` for each hex value before edits; if a non-line consumer surfaces, decide per-call whether it needs theme-swap or should pin to original hex. |
| Dark `--chart-spark-neutral` (bright blue) clashes with the surrounding accent indigo on cards that share the gradient | Verify in dark-mode screenshot pass; if collision is real, drop chroma to `oklch(70% 0.06 260)` (cooler/desaturated). |
| TikTok at `oklch(72% 0.02 250)` reads as "light gray" and someone unfamiliar misreads it as "no data" | The legend swatch still reads "TikTok" with its own dot — same as today's light mode. Operator already familiar with slate-as-tiktok. |

## File touchpoints (anticipated)

```
dashboard-web/src/app/globals.css                                +30 lines (light tokens + dark overrides)
dashboard-web/src/lib/storeColors.ts                             ~5 lines edited
dashboard-web/src/lib/chartColors.ts                             ~10 lines edited (+ header comment update)
dashboard-web/src/components/KpiCards.tsx                        3 lines edited
dashboard-web/src/lib/__tests__/storeColors.test.ts              ~10 lines edited
dashboard-web/src/lib/__tests__/chartColors.test.ts              ~15 lines edited
dashboard-web/src/app/__tests__/globals-chart-vars.test.ts       NEW (~40 lines)
docs/user-manual/...                                             1 changelog entry + version bump
```

Estimated total: ~1 hour focused work + 15 min visual verification.

## Out of scope (deferred)

- Tooltip surface chrome (still uses raw `rgba(13, 37, 61, 0.96)` in `globals.css:174` — a separate Plan-7 carryover).
- HeroOverview hero gradient (intentionally accent-driven, not categorical).
- `ANNOTATION_KIND_COLOR` annotations rail in HeroOverview (separate semantic family).
- FALLBACK_PALETTE for unknown stores (5 unused fallback hex values — only triggers if a 4th store is added, which has no near-term roadmap).

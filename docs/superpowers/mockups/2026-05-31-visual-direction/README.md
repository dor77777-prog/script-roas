# Visual direction mockups — 2026-05-31

Static HTML mockups produced during the visual brainstorming pass that followed the Phase 1 audit and Phase 2 plan. Open any file in a browser to see the rendered design — they use OKLCH colors, Heebo / Inter / Geist Mono via Google Fonts, and backdrop-filter for glass surfaces.

**Implementation reference for Phase 3 / Wave 1 must match these mockups visually.** The CSS in each file is reasonable starting code — copy the token values, the gradient definitions, the box-shadow stacks, and the structural HTML patterns.

## Reading order (chronological)

| File | What it locks |
|---|---|
| `mockup-01-color-palette.html` | OKLCH palette canvas — brand-mirrored chart colors (Meta `#1877F2`, Google `#FBBC04`, TikTok shifted-pink), violet accent (~hue 280), Shopify as muted-green category, 3 store hues, status bands, surface scale (light + dark side-by-side) |
| `mockup-02e-depth-levels.html` | **Direction flip locked** — user picked D (glassmorphism + neon edges) over A (Linear-flat). This reversed the Phase 1 audit's "hairline-borders, editorial discipline" thesis |
| `mockup-03-primitives-glass.html` | Primitive set in glass+neon — Button (primary violet glow / secondary glass / ghost / destructive / icon), Badge variants, Stat (hero/standard/mini), Card variants, Input / Select / Tabs, Sheet preview |
| `mockup-04f-v4-final.html` | **V4 band signal locked** — solid 3px top bar with glow + ROAS number rendered in band color + small band chip. Hue separation: red OKLCH `h22`, orange `h75` (53° apart, not confusable) |
| `mockup-04g-layout-fix.html` | Layout discipline reference — `overflow: visible` on cards, `* { min-width: 0 }` on grid items, vertical-stack CPM cells |
| `mockup-04h-roas-chart-section.html` | ROAS-vs-target chart section — TL;DR sentence, 5-up KPI strip, dashed target line, ROAS data line with hover dots, annotation pins (💰) with hover-only tooltips, footer with prev-period comparison |
| `mockup-04i-store-emphasis.html` | Per-store semantic emphasis — Spend always red (↓), Revenue always green (↑), AOV conditional (`> $70` green ▴ / `< $50` red ▾ / mid neutral), Orders neutral, **CPM values always white** |
| `mockup-04-final.html` | **The full new Home** stitched together — sidebar + header + hero strip + per-store row + ROAS chart + insights + activity feed. Note: per-store row goes BEFORE the ROAS chart (locked separately after this file was written) |
| `mockup-05-freshness-desaturation.html` | 3-stage freshness — fresh < 15 min (`saturate(1.0)`) / aging 15-30 min (`saturate(0.60)` / stale > 30 min (`saturate(0.30) brightness(0.95)`). 600 ms transition |
| `mockup-06-sidebar.html` | Slim 72px icon-rail (default) vs expanded 220px (hover/click/⌘\\ pin). Tooltip on collapsed-state hover shows label + keyboard shortcut |

## Locked decisions cross-reference

All design decisions captured in user-memory at `/Users/dorperetz/.claude/projects/-Users-dorperetz-script-roas/memory/`:
- `project_phase1_audit_decisions_2026_05_31.md` — 10 base Q&A decisions (brand-mirrored / violet / Shopify category / slim sidebar / aggressive stale / authoritative Hebrew / drawer+deep-link / GoalTracker on P&L / Playwright CI / drawer hard cut)
- `project_visual_direction_flip_2026_05_31.md` — direction reversal (Linear-flat → glass+neon)
- `feedback_roas_state_gradient.md` — V4 signal mechanism (top bar + number + chip)
- `feedback_home_visual_rules.md` — semantic emphasis + section order + chart pins + date picker + CPM white
- `feedback_freshness_desaturation_thresholds.md` — 3-stage freshness CSS classes

## Note for implementation agents

These mockups are visual targets, not literal HTML/CSS to ship. The real implementation must:
- Use the OKLCH token system in `dashboard-web/src/app/globals.css` (extended per Wave 1)
- Consume the new `Stat` / `Card` / `Sheet` / `Badge` / `Button` primitives (Wave 2 enforces adoption)
- Bind data to actual Supabase queries (not hard-coded `$4,847` strings)
- Render in Hebrew RTL with proper `<bdi>` wrapping for mixed Hebrew/English text
- Pass the Playwright visual-regression CI gate added in Wave 6

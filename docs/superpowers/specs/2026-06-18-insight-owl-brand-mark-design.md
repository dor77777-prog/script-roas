# Insight Owl — ROAS Tracker brand mark (design)

**Date:** 2026-06-18 · **Status:** approved (operator picked the owl, then variant A)

## Concept / message
A minimal, geometric **owl** — *the sharp-eyed watcher of your ad spend*. The two
oversized eyes read as **two live dashboards / lenses** locked on performance; the
small **target/aim beak** ties "owl" to "hit your ROAS target". A friendly-but-smart
mascot in the Triple-Whale spirit: an ownable symbol, not a generic chart icon — the
brand symbol "for the road ahead".

Chosen from an 8-direction explore (target · loop · peak · radar · **owl** · monogram ·
compass · gauge), then refined to **variant A**: orange beak + solid pupils.

## Visual spec
- **Palette (fixed in BOTH themes — a brand mark, not theme tokens):** violet gradient
  `#7551FF → #422AFB → #2111A5`; eyes `#F4F7FE`; pupils `#2111A5` + white catchlight;
  beak `#EF9331` (the one band accent — brand orange = "aim/target").
- **Two forms:**
  - **Tile** (`owl-mark.svg`) — owl face on a violet rounded square. Used for the
    sidebar mark + the favicon. Bold enough for 16px.
  - **Logo** (`owl-logo.svg`) — full owl body (ear tufts) in the gradient, no tile.
    For larger/standalone brand use (login, OG, future).
- **viewBox** `0 0 64 64`, self-contained, no raster, no text.

## Where it lives
- `public/brand/owl-mark.svg` — sidebar brand mark (`<img>`, replaces the old violet
  gradient tile at `Sidebar.tsx`).
- `public/brand/owl-logo.svg` — standalone logo (full body), for future surfaces.
- `src/app/icon.svg` — Next.js App-Router favicon (auto-served as `rel="icon"`).

## Why static `.svg` (not an inline `.tsx` SVG)
The mark's brand hex is FIXED (violet/orange in both themes). Inlining it in a `.tsx`
component would trip the token-only `designColorGuard` (bans raw hex in
`src/components/**` + `src/app/**` `.tsx`). Keeping it in `.svg` files puts the fixed
brand colour where it belongs and keeps the guard green.

## Usage rules
- Min size 16px (favicon). Clearspace ≈ ¼ of the mark's width on all sides.
- Don't recolour, rotate, add effects, or stretch. The beak orange is the only accent —
  do not add more colours.

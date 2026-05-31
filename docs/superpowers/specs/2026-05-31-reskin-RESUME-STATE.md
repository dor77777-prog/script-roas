# RESUME STATE — Dashboard Re-skin (mesh light+dark) · paused 2026-05-31 evening

**To resume:** operator will say **"חזרתי"**. Read this file first, then continue from "NEXT STEPS".

---

## ⚠️ Operator's standing instructions (learned this session — DO NOT repeat the mistakes)
1. **STOP the drip-deploy cycle.** Do NOT fix-one-thing-then-deploy repeatedly — it surfaced one broken surface at a time and frustrated the operator. Instead: **audit EVERYTHING locally, fix all, verify every tab in both themes locally, then ONE single deploy.**
2. **Match the mockup EXACTLY** — not "similar". Card *backgrounds*, *text colors*, *buttons* — all must equal the mockup (`mesh` light / `dark-mesh` dark).
3. **Guards must NOT block the design.** If a lint rule / test conflicts with matching the mockup, UPDATE the guard. Never break data/functionality/the system.
4. Deliver visuals; operator compares prod to the mockup themselves. Don't claim "matches" without verifying.

## Git / deploy state at pause
- **origin/main = `c7e3f7a`** → THIS IS LIVE ON PROD (https://roas-dashboard-smoky.vercel.app).
- **Local HEAD = `16fbed7`** = 1 commit AHEAD of origin, **NOT pushed / NOT deployed** ("the HELD fix"):
  `fix(ui-ux): flat card surfaces + calm single-glow page wash (match mockup); green value series; define surface-elevated-1; aggressive-compact per-store numbers`
- **Uncommitted working tree:** `docs/ROAS-Dashboard-User-Manual.md` (version bumped to 2.6.3 + a changelog entry — was prepping the next deploy's docs-gate). Untracked `.claire/` = ignore.
- Tests/tsc/lint were GREEN at `16fbed7` (1748 vitest pass).

## What the HELD fix (`16fbed7`, local only) contains — it's GOOD, just not deployed
- `.glass` cards → FLAT (`background: var(--glass-1)`, removed the `glass-2→glass-1` gradient + backdrop-filter) — matches mockup flat cards.
- Body wash → single subtle glow (`--bg-glow`: dark `rgba(124,108,255,.13)` / light `rgba(14,165,183,.10)`) over flat canvas; removed the 3-radial wash + animated conic (`body::before` kept as a faint static glow for the glassTokens grep + reduced-motion).
- `CHART_COLORS.value` → `var(--up)` green, `spend` → `var(--dn)` red (#ef4d5b).
- Defined `--surface-elevated-1: var(--glass-2)` (BOTH blocks) — was UNDEFINED, broke TodayLive card bg + CampaignsTable/Drawer chart-dot strokes.
- Per-store metric numbers → `fmtMoneyCompactTight()` (abbreviates ≥1000 → $5.8K) so they stop truncating at the enlarged size.
- Verified locally (localhost:3000, both themes): flat cards + calm canvas look right, match the mockup.

## What is ALREADY DEPLOYED on prod (`c7e3f7a`) and verified-correct
- Light + dark themes via `[data-theme]`; default = follow system. Toggle in Sidebar + Command Palette. Pre-paint FOUC bootstrap; no flash.
- Palette = exact mockup: LIGHT (mesh) white cards `#fff`, canvas `#edf0f8`, TEAL accent `#0ea5b7`; DARK (dark-mesh) opaque navy `#171a2e`/`#1d2138`, canvas `#0d0f1e`, VIOLET accent `#7c6cff`; ink stacks `#171a2b…` / `#eef1ff…`.
- Band cards (per-store + featured hero) = VIVID 3-layer radial gradient (red `#ff6b81→#e11d48`, orange `#ffb24d→#f97316`, green `#34e2ad→#0f9d6b`, blue `#5b8df0→#2563eb`) + WHITE big number. Secondary hero cards = NEUTRAL (no glow). Per-store cards VIVID (gentle freshness fade now, not saturate(0.3)).
- Platform brand colors exact: Meta `#1877f2` · Google `#f4a200` · TikTok `#ff2e7e`. Up `#0fb37a` / Down `#ef4d5b`. Status green/blue/amber/red = `#0fb37a`/`#3b82f6`/`#f59e0b`/`#ef4d5b`. Sidebar dark `#15182a` in BOTH themes (violet logo). Tooltips theme-consistent.
- Guards updated (hex→hue parser; 3 mockup-locked thresholds lowered). vitest 1748 green.

## 🔴 OPEN BUG CLASS — the reason we paused: hardcoded NON-TOKEN colors in components
The global *tokens* are correct, but **individual components bypass tokens with hardcoded dark-only classes** that break in light (and some in dark). This needs a FULL component audit (do NOT fix one-at-a-time).
- **CONFIRMED example (top bar / CommandBar / search):** the "K" shortcut `<kbd>` is `bg-white/15 text-white/85` → **white-on-white, invisible in light mode**. The search + sync borders use a hardcoded `#e5e7eb` (raw gray-200), not `--glass-edge`.
- These were found in the top-bar. There are almost certainly MORE across components (anything using `white/NN`, `black/NN`, raw Tailwind palette like `gray-200`, `emerald-300`, `slate-700`, or `text-white`/`bg-white` not via a token). ESLint `no-hex-color-in-components` does NOT catch `bg-white/15` or `gray-200` named utilities.

## NEXT STEPS (when operator says "חזרתי")
1. **Confirm approach with operator** (they were mid-deciding): the plan is "full audit → fix all → verify all tabs both themes locally → ONE deploy". The HELD fix `16fbed7` (flat cards + calm wash) is good — bundle it into that single deploy.
2. **AUDIT** every component for hardcoded non-token colors that break in either theme. Grep for: `white/`, `black/`, `bg-white`, `text-white`, `border-white`, raw Tailwind named colors (`gray-`, `slate-`, `zinc-`, `neutral-`, `emerald-`, `rose-`, `amber-`, `red-`, `blue-`, `green-` + number), and inline `#hex`/`rgba(255,255,255` in `.tsx`. Replace each with the right theme token (`--glass-*`, `--text*`, `--glass-edge`, `--status-*`, etc.). Start with the top-bar/CommandBar (search, K kbd, sync chip), then sweep all tabs' components.
3. **Verify locally** (localhost:3000 via chrome-devtools), BOTH themes, every tab. NOTE: local dev has **NO Supabase creds** (`.env.local` lacks `SUPABASE_URL`/`ANON_KEY`) → data-backed views are empty/gray locally. Use `/dev/primitives` (band cards, badges, freshness, buttons) + empty-state Home/Campaigns for surface/color checks; reserve data-backed checks for PROD after the single deploy.
4. **Single deploy:** bump User Manual (docs-currency gate fires on any `components/*.tsx` change → requires `docs/ROAS-Dashboard-User-Manual.md` in the push; ARCHITECTURE.md required only for inngest/migrations/fetchers changes). `git push origin main`. Pre-push gate runs tsc+vitest+lint+docs-currency.
5. **Verify on PROD with real data**, both themes, EVERY tab vs the mockup: Home (per-store + hero + chart), P&L (GoalTracker, PnLBreakdown), Analysis (Trends multi-store line + History MonthlyTables 4-band cells + black '0'), Campaigns (winners/watch, KPI strip, dense table A/B/C/D badges + sparklines + ROAS cells, reconciliation) + CampaignDrawer (6 sub-tabs, charts Spend↔Value green/red + CPM, health bars), Products, Detail, Operator.
6. THEN resume the original plan tail: **Phase 6** mobile (operator responsive, clipped-tooltip portal CampaignsTable:~2452 + HealthScoreBadge, TabHeader/lg-xl), **Phase 7.1** Playwright light+dark snapshot projects (config locked 1440×900 dark-only — add light project + regenerate), **Phase 7.2** ARCHITECTURE/User-Manual final + full green gate.

## Reference
- Mockup (SOURCE OF TRUTH): `docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html` — directions `mesh` (light) + `dark-mesh` (dark). Drawer mockup (approved): `…/campaign-drawer-mockup.html`.
- Complete mockup color spec is enumerated in the v2.6.0–2.6.3 User Manual changelog + this session's commits.
- Deploy-live poll pattern: `curl prod / | grep css link → fetch that css → grep for a NEW marker unique to the deploy` (e.g. a new hex you just added). Vercel build ≈ 2–4 min.
- Original plan: `docs/superpowers/plans/2026-05-31-dashboard-reskin-mesh-lightdark.md`. Original handoff: `…/specs/2026-05-31-handoff-reskin-execution.md`.

## Tests/guards touched this session (so they stay green)
`themeParity` (every token in both blocks — incl. new `--bg-glow`, `--surface-elevated-1`, `--sidebar*`), `glassTokens`/`chartTokens`/`colorCollisions` (hex→hue parser added; 3 thresholds lowered "mockup-locked"), `chartColors.test`, `useStaleness` doc-comment. Keep all green; update (don't weaken) if a mockup-match requires it.

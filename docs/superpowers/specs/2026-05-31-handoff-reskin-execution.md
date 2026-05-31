# HANDOFF — Dashboard Re-skin (Mesh, Light+Dark) — ready to EXECUTE

**Date:** 2026-05-31 · **State:** brainstorming + planning COMPLETE, spec APPROVED, ready to implement.

## ⟶ RESUME PROMPT (paste this verbatim in a fresh session after clearing context)

```
Resume the ROAS dashboard re-skin (mesh, light+dark). We finished brainstorming + planning;
the spec is APPROVED and committed. Do NOT re-brainstorm and do NOT re-scan the codebase.

Read, in order:
1. docs/superpowers/specs/2026-05-31-handoff-reskin-execution.md   (this handoff — state, decisions, rules)
2. docs/superpowers/plans/2026-05-31-dashboard-reskin-mesh-lightdark.md   (the implementation plan — self-contained; embeds the full codebase map; DO NOT re-scan)
3. docs/superpowers/specs/2026-05-31-dashboard-reskin-mesh-lightdark-design.md   (the approved spec)

Visual target: run `open docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html`
(direction "mesh" = light, "dark-mesh" = dark; chosen pair). Deliver any new mockups to me as an
`open <file>` link — never paste screenshots.

Rules: work on `main` (no branches; push only when I ask). All UI = light+dark from the start,
token-driven (no hardcoded styles), mobile-first, isolated primitives. App dir: dashboard-web/.
Verify on the prod URL roas-dashboard-smoky.vercel.app, never localhost.

Start executing the plan via the superpowers:subagent-driven-development skill, beginning at Phase 0
(baseline green + theme-parity guard). Confirm the baseline is green before changing anything.
```

## Where we are
- **Process:** superpowers brainstorming → spec (approved by operator) → writing-plans (done) → **next: execute**.
- **Git:** branch `main`, HEAD `6db8909` (`docs(ui-ux): mesh light+dark re-skin — design spec + interactive mockups`). This handoff + the plan will be the next commit. Untracked `.claire/` is leftover — ignore, don't commit. Local `main` was fast-forwarded to origin earlier; **not pushed** since (push only when operator asks).

## Locked decisions
- Direction: **"mesh rich gradient", LIGHT + DARK** (runtime toggle). Re-skin ONLY — layout/IA/data/ROAS-thresholds unchanged; no info loss across tabs.
- ROAS-signal cards (per-store + global business KPI) stay band-colored as rich gradients (strong headline / muted secondary). Bands: red<2 / orange2-2.7 / green2.7-3 / blue≥3 / gray.
- Table ROAS cells: 4-band; spend-no-sale "failure" day = **black '0'** (unify the MonthlyTables `bg-black` vs DetailTable `bg-status-red` discrepancy).
- **Platform-color fix** (operator pain point): vivid brand dot + contrast ring + per-platform cell tint via the existing unused `.cell[data-platform]` hook; exempt from freshness `saturate()`.
- Charts keep real axes/gridlines/labels/target/pins (re-theme via `--chart-*` vars only).
- **Mobile-first** is a hard requirement (close Operator/large-desktop/tooltip-clip gaps).
- Default theme = **system**, user-overridable + persisted.

## Artifacts
- Approved spec: `docs/superpowers/specs/2026-05-31-dashboard-reskin-mesh-lightdark-design.md`
- Implementation plan (self-contained, embeds codebase map): `docs/superpowers/plans/2026-05-31-dashboard-reskin-mesh-lightdark.md`
- Interactive mockup: `docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html` (+ `home.html` older single-page)
- ⚠️ The 5-agent codebase scan reports were **not** saved as separate files — their findings are **embedded in the plan's "Codebase map" section**. Use the plan; do not re-run the scan.

## Workflow rules (operator preferences — also in global ~/.claude/CLAUDE.md)
- Deliver mockups as openable links / `open <file>`, NOT pasted screenshots (operator dislikes them; screenshots are fine for your own verification only).
- Prefer chrome-devtools MCP / MCP tools for anything visual.
- Any UI with a design aspect: light+dark + token-driven + mobile-first + isolated primitives, from the start.
- Commit on `main`, no feature branches; push only when explicitly asked.
- Ask before building a mockup for non-trivial UI.

## Immediate next action
Execute the plan starting Phase 0 (verify baseline green; add the `themeParity` guard as a red gate), then Phase 1 (reactivate ThemeProvider/layout), etc. Use superpowers:subagent-driven-development.

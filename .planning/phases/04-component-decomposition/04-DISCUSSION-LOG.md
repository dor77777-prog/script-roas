# Phase 4: Component Decomposition — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 04-component-decomposition
**Areas discussed:** Hook directory location, Sub-component co-location, Regression confidence strategy, Line cap interpretation

---

## Hook directory location

| Option | Description | Selected |
|--------|-------------|----------|
| `lib/hooks/` (subdir) | Group all hooks together under `lib/hooks/`. Separates pure data helpers (`lib/*.ts`) from React hooks. Plan default. Convention for entire project going forward. | ✓ |
| `lib/` flat | Hooks alongside other lib helpers — matches existing flat convention (attributionAnalysis.ts, cloudSync.ts in `lib/`). Mixes React hooks with pure helpers. | |
| `components/<parent>/` | Co-locate each hook with its parent component in a per-component subdirectory. Strongest coupling signal but introduces subdirectories in `components/`. | |

**User's choice:** `lib/hooks/` (subdir)
**Notes:** No custom hooks exist in the project today — this is a green-field convention choice. Future hooks (Phase 5/6/7) inherit `lib/hooks/`.

---

## Sub-component co-location

| Option | Description | Selected |
|--------|-------------|----------|
| Flat in `components/` | Continue the current flat convention. All ~30 components share the same directory. Zero churn in existing import paths. | ✓ |
| Per-parent subdirs | Group sub-components under their parent (e.g., `components/CampaignDrawer/`). Requires moving the parent files themselves and updating imports across the app. | |
| Hybrid (prefixed flat) | Flat but with parent-name prefix (e.g., `CampaignDrawerAttributionPanel.tsx`). No directory churn but long file names. | |

**User's choice:** Flat in `components/`
**Notes:** ~6-7 new files added to `components/` for ~37 total — still manageable. Reconsider only when count crosses ~50.

---

## Regression confidence strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Existing tests + build + smoke (Recommended) | Phase 2's 84 unit tests + `npm run build` after every task + manual smoke through 3 tabs. No new tests. Fastest path. | ✓ |
| + add 5-10 hook unit tests | Same plus extract 5-10 hook-level unit tests (e.g., `useCampaignTrueRevenue`). Locks the extraction contract. ~2-3h extra work; `@testing-library/react` may need adding. | |
| + visual diff screenshots | Above + Playwright/Storybook visual regression screenshots of the 3 tabs. Catches CSS/DOM-order drift. Significant tooling addition; overkill for internal refactor. | |

**User's choice:** Existing tests + build + smoke (Recommended)
**Notes:** Hook unit tests deferred to Phase 7 if a regression actually shows up. Refactor is mechanical extraction of verbatim `useMemo` blocks that have run in production for months — risk is low.

---

## Line cap interpretation

| Option | Description | Selected |
|--------|-------------|----------|
| Soft target (Recommended) | Aim for ≤500 but accept up to ~600 if the only way to get under 500 is an artificial split. The point is cognitive load reduction, not the number. | ✓ |
| Hard cap | If a shell lands at >500, force a deeper split (extract toolbar, tab bar, etc.). Literally satisfies ROADMAP success criterion #1. May create thin wrapper components. | |
| Hard cap with escape hatch | Hard cap by default; if no natural seam exists under 500, document the deviation and continue. Verifier accepts the override. | |

**User's choice:** Soft target (Recommended)
**Notes:** Executor must document any over-500 file: line count, seams considered, why no further split is justified. Verifier may flag it like Phase 2's `safeDecode` override.

---

## Claude's Discretion

- **Decomposition execution order + parallelism (D-06):** sequential CampaignsTable → CampaignDrawer → BillingSettings recommended so `npm run test` can run cleanly between components and avoid 3 simultaneous refactors in the same working tree. Planner may choose mini-waves if the dependency graph allows.
- **Per-task atomic commits (D-07):** 1 task = 1 commit. If a deviation under D-04 triggers an additional split, that becomes its own task + commit.
- **Hebrew RTL preservation (D-05):** captured as a guardrail rather than a discussion item — not a real gray area, but worth locking down explicitly to prevent any executor "normalization" mistakes.

## Deferred Ideas

- Hook unit tests → Phase 7 (Observability) if regression actually shows
- Visual regression tooling (Playwright/Storybook) → not planned (overkill)
- Per-parent subdirectories in `components/` → deferred indefinitely; revisit at ~50+ files
- Hybrid prefixed naming → rejected (chose flat unprefixed instead)
- Splitting other potentially-large components (Dashboard, ProductsTable, AdsDrawer) → out of scope for Phase 4; track separately if/when they cross 500 lines
- `engines` field in root `package.json` (Phase 3 code review IN-01) → Phase 7 with other DX hardening recommendations

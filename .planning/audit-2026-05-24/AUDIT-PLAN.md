# End-to-End Audit — 2026-05-24 (MT / Multi-Track)

**Method:** Eight parallel `general-purpose` subagents dispatched concurrently via the `superpowers:dispatching-parallel-agents` pattern. Each agent is read-only, scoped to one domain, and writes its findings to a dedicated file under `.planning/audit-2026-05-24/`.

**Context baseline:**
- Post-Phase-11 single-tier codebase: Next.js 15 + React 19 + Inngest 4.4 + Supabase Postgres + Sentry + Vitest. No Apps Script tier remains.
- Existing audit baselines: `.planning/audit-2026-05-23/`, `audit-2026-05-23-v2/`, `audit-2026-05-23-v3/` (the v3 folder contains a 4-part Opus review + Codex verification). This new run is an end-to-end refresh capturing post-12.5.x state (RTL AI report, SWR cache hardening, P&L breakdown realtime).
- Project memory constraints honoured by every track:
  - **Internal tool, single-user max, URL-obscurity trust model** → security findings calibrated accordingly (no enterprise auth recommendations).
  - **No localhost in verify checks** → any verification recipes must hit production URLs.
  - **Docs split by audience** → User Manual = UX; `docs/ARCHITECTURE.md` = architecture.
  - **Monthly goal panel is global** → GoalTracker correctness check must respect this.

## Tracks

| # | Track | Output file | Focus |
|---|-------|-------------|-------|
| 1 | Security & Static Analysis | `01-SECURITY.md` | OWASP review of API/operator routes, OAuth callback, secrets in repo, Supabase RLS posture, Sentry PII, semgrep delta |
| 2 | Algorithmic Correctness | `02-ALGORITHMS.md` | `attributionAnalysis`, `shopifyRevenueRefunds`, `campaignHealthScore`, `multiMappingCohort`, `cannibalizationDetection`, `productCentricView`, `costs`, `billing` |
| 3 | Data Pipeline Integrity | `03-PIPELINE.md` | Inngest cron functions, reader/writer symmetry in `postgresReaders.ts`, fetchers' error handling, migration discipline, OAuth refresh, idempotency |
| 4 | Architecture & Refactoring | `04-ARCHITECTURE.md` | File-size hotspots (especially `cronDaily.ts`), coupling, dead code, abstraction quality, decomposition opportunities |
| 5 | Code Maturity & Testing | `05-MATURITY.md` | Test coverage gaps (only 1 component spec!), test-quality smells, error-handling patterns, complexity hotspots, type safety |
| 6 | Frontend / UX / Accessibility | `06-FRONTEND.md` | Component quality, RTL correctness, a11y, SWR + cloudSync correctness, drawer stack, urlState, design tokens usage |
| 7 | Docs Currency & Audience Split | `07-DOCS.md` | User Manual ↔ actual features parity, ARCHITECTURE.md vs reality, PROPS-MAP.md completeness, README/WELCOME/SYSTEM_OVERVIEW currency |
| 8 | Performance & Observability | `08-PERF-OBSERVABILITY.md` | Sentry coverage gaps, slow Postgres queries, caching headers correctness, payload sizes, hot rerender paths, alert coverage |

## Aggregation

After all 8 agents return, a master report at `MASTER-REPORT.md` consolidates findings into a prioritised matrix:
- **P0** — production-affecting bug, data corruption, or security exposure that warrants immediate fix.
- **P1** — significant maturity / correctness gap, should be in next phase.
- **P2** — refactor / nice-to-have / docs drift.

Each finding includes file:line references and a recommended remediation owner (existing phase folder if applicable).

## Constraints for every agent

1. **Read-only.** No `Edit`, `Write` (except the single findings file), no `git` operations, no `npm install`.
2. **Save findings to the exact path specified.** Do not invent new files outside `.planning/audit-2026-05-24/`.
3. **Return a short text summary** (≤300 words) so the coordinator can aggregate without re-reading the full file.
4. **Cite file:line for every finding.** No vague "somewhere in the codebase" claims.
5. **Don't restate the obvious.** Skip "this codebase uses TypeScript" — focus on issues and opportunities.

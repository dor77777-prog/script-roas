# PROJECT: ROAS Tracker — Single-Operator Multi-Store Ad Performance Dashboard

> Bootstrapped retroactively 2026-05-24 to support `/gsd-new-milestone v2.0`. The project was previously running on ad-hoc `.planning/` content (ROADMAP.md + STATE.md only); this file fills the formal gap the workflow expects.

## What This Is

A Next.js 15 + React 19 dashboard for **one operator** managing 3 Shopify stores (uzoshop, Zol Plus, 360usmile) and their ad spend across Meta + Google Ads + TikTok. Production URL: https://roas-dashboard-smoky.vercel.app

The system replaces a manual morning routine (login → copy spend → paste → convert currency → calculate ROAS) with an automated pipeline: Inngest crons collect from external APIs → Supabase Postgres → Next.js API routes → React UI with drill-down + cloud-synced operator state.

Hebrew RTL UI throughout. Single-tier post-Phase-11 (May 2026 — Apps Script tier decommissioned).

## Core Value

Convert per-platform ad reporting + per-store Shopify revenue into one trust-scored truth: **what each campaign / ad-set / ad actually returned**, after refunds, COGS, transaction fees, and fixed costs — broken down per platform, per product, per cohort, and per day.

The operator's daily decision loop: which campaigns to scale, pause, or reallocate, based on the dashboard.

## Stores + Active Integrations

| Store | Meta | Google | TikTok | Shopify |
|---|---|---|---|---|
| uzoshop | ✅ | ✅ | ✅ | ✅ |
| Zol Plus | ✅ | — | — | ✅ |
| 360usmile | ✅ | — | — | ✅ |

## Trust Model

- Single operator — URL-obscurity is the trust boundary.
- No multi-tenant ambitions.
- No auth on inner routes (accepted decision; documented as `.planning/codebase/CONCERNS.md`).

## Current Milestone: v2.0 — Codebase Audit Baseline

**Goal:** Produce a documented baseline of "verified correct" for every algorithm, component, and inter-component channel in the active codebase, so future planning/execution does not inherit or hide existing bugs.

**Why now:** v1.0 shipped 12 phases (0–12), several through reactive bug-fix audits (v1/v2/v3 in `audit-2026-05-23*/`). The operator has explicitly stated all pending v1.0 phases that did not ship are abandoned. Before further significant work, we want one comprehensive, evidence-backed audit.

**Phases (within this milestone):**
1. Phase 12 — Codebase Audit Baseline (documentation only, no source-code changes)
2. Phase 12.x — Conditional fix phases if 🔴 critical findings surface

**Out of scope (deferred from v1.0):** Phase 2, 4, 5, 5.4, 6, 7, 8 — the pre-Phase-9 backlog. Operator confirmed 2026-05-24 these are not happening.

## Project Conventions

- TypeScript strict mode + vitest + tsc clean after every commit.
- Atomic commits per finding with audit IDs in the commit message.
- Hebrew RTL UI — `start/end` Tailwind utilities, not `left/right`.
- All TZ resolution uses `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })`.
- Per-store COGS via `${STORE_UPPERCASE}_COGS_RATE` env var (fallback `COGS_RATE_OF_REVENUE = 0.25`).
- All currency CAD; ILS/USD/EUR converted via fx.ts (Frankfurter API).
- No `git add -A` rule (lesson from v1 git-add race during Wave 1).

## Validated Capabilities (from prior milestones)

- v1 / v2 / v3 audit + 77+9 commits worth of remediation (Phases 9–12).
- Apps Script tier fully removed (Phase 11).
- Per-platform CPM in TodayLive cards (operator request, post-Phase-10).
- Halo-warning chip in attribution panel (Phase 12, AUDIT U-05).

For the deep dive on the current code state see:
- `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `STACK.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `TESTING.md`, `CONCERNS.md`
- `.planning/graphs/GRAPH_REPORT.md` (knowledge graph, 7,625 nodes / 9,107 edges)
- `.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md` (last formal audit, scoped to 10 surfaces)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

*Last updated: 2026-05-24 — milestone v2.0 audit-baseline started*

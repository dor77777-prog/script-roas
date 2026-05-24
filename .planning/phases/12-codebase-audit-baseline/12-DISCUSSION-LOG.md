# Phase 12: Codebase Audit Baseline — Discussion Log

**Date:** 2026-05-24
**Mode:** Standard discuss-phase
**Pre-locked decisions:** 17 operator-supplied (D-01..D-17, minus D-06 cancelled)
**Discuss-phase additions:** 4 logistic resolutions (DP-01..DP-04)

This log is for human reference (audits, retrospectives). It is NOT consumed by downstream agents — they read `12-CONTEXT.md` for decisions and `12-SPEC.md` for requirements.

---

## How the discussion went

This was a unique discuss-phase because the operator had already published a comprehensive 17-D-decision pre-lock in their original milestone-kickoff prompt. The discuss-phase honored that pre-lock and avoided re-litigating any covered ground. Only logistic gaps not covered by D-01..D-17 were surfaced.

The 4 logistic gaps + operator's resolutions:

### DP-01: Wave split mechanics

**Gray area:** D-01 specifies "parallel waves of ~10". With 134 files, that's 14 waves — how to chunk?

**Options presented:**
1. By directory (Recommended) — keep context tight per reviewer
2. By file size — solo waves for big files
3. By risk profile — already-audited first, cold files last

**Operator's choice:** Option 1 — by directory.

**Reasoning given:** "המטרה: לשמור context קרוב לכל reviewer ולא לערבב תחומים לא קשורים."

---

### DP-02: Operator-checkpoint timing

**Gray area:** D-08 says ⚠️ Uncertain → operator triage. When in the execution flow?

**Options presented:**
1. Mid-execution after all reviewers, before AUDIT.md write (Recommended)
2. Pre-write: real-time per reviewer completion
3. Post-write: ship AUDIT.md with ⚠️, resolve offline

**Operator's choice:** Option 1 — mid-execution.

**Reasoning given:** All reviewers finish their work first. Then aggregate ⚠️. Then one operator checkpoint. Then final AUDIT.md.

---

### DP-03: Triage UX

**Gray area:** How to physically ask the operator to resolve the ⚠️ entries?

**Options presented:**
1. Batched AskUserQuestion with table (Recommended) — split into prompts of 3-4 if >4 findings
2. One-by-one prompt per finding

**Operator's choice:** Option 1 — batched.

**Reasoning given:** Aggregated table approach. If too many findings, split into multiple prompts of 3-4 each.

---

### DP-04: AUDIT.md write strategy

**Gray area:** D-04 says orchestrator merges into AUDIT.md. Write incrementally per wave, or all-at-once at the end?

**Options presented:**
1. All-at-once atomic write (Recommended)
2. Incremental per-wave append

**Operator's choice:** Option 1 — atomic.

**Reasoning given:** No incremental writes to AUDIT.md. All waves complete → all ⚠️ resolved → all decisions locked → ONE atomic write of AUDIT.md.

---

## Deferred ideas (raised, not acted on)

None during this discussion. The operator's pre-lock was comprehensive enough that no scope-creep opportunities surfaced.

## Claude's discretion items

When `gsd-planner` produces PLAN.md (next step), it has discretion on:
- Exact wave numbering (DP-01 named directory-clusters but didn't enforce specific Wave A/B/C labels)
- Exact file-to-wave assignment within each directory cluster
- Number of sub-waves needed for the bigger directory clusters (e.g., components-bizlogic at 40 files needs 4 sub-waves)
- Concrete `raw-returns/` directory path and JSON schema (DP-04 sketched the concept; planner formalizes)
- Cross-AI Codex invocation shape — could be in-line during the algorithm wave OR a separate verify-pass between mid-execution checkpoint and AUDIT.md write

These are within the spirit of the locked decisions and don't require operator confirmation. If `gsd-planner` runs into an ambiguity that DOES require confirmation, it should surface it before PLAN.md is finalized.

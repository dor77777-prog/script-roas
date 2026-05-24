---
phase: 12-codebase-audit-baseline
plan: 00
type: execute
wave: 0
depends_on: []
files_modified:
  - .planning/phases/12-codebase-audit-baseline/raw-returns/
  - .planning/phases/12-codebase-audit-baseline/12-CHANNELS.md
  - .planning/phases/12-codebase-audit-baseline/12-tests-needed.md
  - .planning/AUDIT.md
autonomous: false
requirements: [REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7, REQ-8]
tags: [audit, baseline, documentation-only]

must_haves:
  truths:
    - "Every one of 134 in-scope files has exactly one verdict in AUDIT.md (✅ or 🔴; zero ⚠️)"
    - "Every 🔴 entry contains all 5 D-02 fields (file:line, failing input, expected, actual, fix sketch + regression-test idea)"
    - "12-CHANNELS.md enumerates ≥5 channel-type sections (imports/props/events/SWR keys/Inngest/Supabase/API)"
    - "12-tests-needed.md ranks ≥10 gaps with top-5 marked verification-blocking"
    - "Every catch site in dashboard-web/src/ is labeled intentional or suspicious"
    - "AUDIT.md ends with bug triage table mapping every 🔴 → severity → fix-phase (12.1/12.2/12.3/backlog)"
    - "Operator-decision log appended to AUDIT.md showing each ⚠️ → ✅/🔴 resolution"
    - "git diff main -- dashboard-web supabase is empty at phase end"
  artifacts:
    - path: ".planning/AUDIT.md"
      provides: "Master per-file verdicts + bug triage + operator-decision log"
      contains: "## Triage Table"
    - path: ".planning/phases/12-codebase-audit-baseline/12-CHANNELS.md"
      provides: "Inter-component channel map (≥5 sections)"
    - path: ".planning/phases/12-codebase-audit-baseline/12-tests-needed.md"
      provides: "Ranked test-gap survey (≥10 gaps)"
    - path: ".planning/phases/12-codebase-audit-baseline/raw-returns/"
      provides: "One structured JSON per reviewed file (134 files)"
  key_links:
    - from: "raw-returns/*.json"
      to: ".planning/AUDIT.md"
      via: "DP-04 in-memory merge → single atomic write"
      pattern: "synthesis-write"
    - from: "raw-returns/*.json ⚠️ entries"
      to: "operator-checkpoint (DP-03)"
      via: "AskUserQuestion batches of 3-4"
      pattern: "triage-loop"
    - from: ".planning/graphs/graph.json + raw-returns inline channel lists"
      to: "12-CHANNELS.md"
      via: "Plan-agent cross-cutting sweep (D-17)"
      pattern: "dedupe-and-group"
---

<objective>
Phase 12 master outline. Coordinates 7 reviewer waves (A–G), 1 mid-execution operator checkpoint, 3 cross-cutting Plan-agent tasks, and 1 atomic AUDIT.md synthesis. All work is documentation-only; **zero source-code changes**.

Purpose: Establish the canonical "verified correct" baseline for every file in the active codebase before milestone v2.0 fix phases begin (12.1+).

Output: `.planning/AUDIT.md` (134 verdicts, zero ⚠️, triage table, decision log) + `12-CHANNELS.md` + `12-tests-needed.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/12-codebase-audit-baseline/12-SPEC.md
@.planning/phases/12-codebase-audit-baseline/12-CONTEXT.md
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/codebase/STRUCTURE.md
@.planning/codebase/ARCHITECTURE.md
@.planning/codebase/TESTING.md
@.planning/codebase/CONCERNS.md
@.planning/audit-2026-05-23-v3/AUDIT-phase9-snapshot.md
@.planning/graphs/GRAPH_REPORT.md
</context>

<wave_structure>

| Wave | Sub-plan | Files | Reviewers | Cross-AI | Owner |
|------|----------|-------|-----------|----------|-------|
| A    | 12-01    | 12 lib/algorithm files | 12 gsd-code-reviewer | 5 Codex passes (statistical) | parallel |
| B    | 12-02    | 16 lib/services files (fetchers + hooks + notifications) | 16 gsd-code-reviewer | — | parallel |
| C1   | 12-03a   | ~12 lib/state-core files (state + supabase + utils) | ~10 gsd-code-reviewer | — | parallel |
| C2   | 12-03b   | ~12 lib/types-formatters | ~10 gsd-code-reviewer | — | parallel |
| C3   | 12-03c   | ~12 lib/domain-data (campaigns, products, billing, costs, annotations) | ~10 gsd-code-reviewer | — | parallel |
| D    | 12-04    | 6 inngest files | 6 gsd-code-reviewer | — | parallel |
| E1   | 12-05a   | ~10 api routes (data + dashboard surface) | ~10 gsd-code-reviewer | — | parallel |
| E2   | 12-05b   | 9 api routes (operator + oauth + debug + inngest webhook) | 9 gsd-code-reviewer | — | parallel |
| F1   | 12-06a   | ~10 components (Dashboard shell, KPI surfaces, filters) | ~10 gsd-code-reviewer | — | parallel |
| F2   | 12-06b   | ~10 components (Campaigns + Drawer surface) | ~10 gsd-code-reviewer | — | parallel |
| F3   | 12-06c   | ~10 components (Products + Insights + Goals surface) | ~10 gsd-code-reviewer | — | parallel |
| F4   | 12-06d   | ~10 components (Billing + Notifications + operator/*) | ~10 gsd-code-reviewer | — | parallel |
| G    | 12-07    | 9 components-borderline | 9 gsd-code-reviewer | — | parallel |
| —    | checkpoint | mid-execution: collect ⚠️, batched AskUserQuestion, resolve to ✅/🔴 | — | — | orchestrator-inline |
| H1   | 12-08    | try/catch sweep across dashboard-web/src/ | 1 Plan-agent | — | sequential after checkpoint |
| H2   | 12-09    | test-coverage gap survey → 12-tests-needed.md | 1 Plan-agent | — | sequential after checkpoint |
| H3   | 12-10    | CHANNELS.md cross-cutting sweep + graphify query | 1 Plan-agent | — | sequential after checkpoint |
| —    | synthesis | atomic AUDIT.md write merging everything in-memory (DP-04) | — | — | orchestrator-inline |

**Concurrency:** ~10 reviewers per parallel wave (DP-01).
**Cross-AI (D-14):** Auto-on for the 5 statistical files in Wave A; Codex pass spawned after Opus pass on each completes. Skip if Opus surfaces zero findings on all 5 (escape hatch).
**Re-research:** ⚠️ → "Re-research" branch from checkpoint runs ONE follow-up reviewer for that file; if still ⚠️ after that pass, operator picks ✅/🔴 (no second re-research).

</wave_structure>

<orchestrator_tasks>

<task type="checkpoint:human-verify" gate="blocking" id="12.X.1">
  <name>Mid-execution checkpoint — resolve all ⚠️ Uncertain (DP-02 + DP-03)</name>
  <what-built>
    All 134 per-file reviewers from Waves A–G have completed. Each wrote a structured return to `.planning/phases/12-codebase-audit-baseline/raw-returns/{FILE_SLUG}.json` (DP-04). The orchestrator has collected every ⚠️ entry across all returns into a single triage queue.
  </what-built>
  <how-to-verify>
    1. Orchestrator scans `.planning/phases/12-codebase-audit-baseline/raw-returns/*.json` and extracts every `verdict: "⚠️ Uncertain"` entry along with its `file`, `reviewer_reasoning`, and `what_would_settle_it` fields.
    2. Orchestrator counts total ⚠️ entries (N). Logs the count.
    3. Orchestrator batches into AskUserQuestion prompts of 3-4 entries each (per DP-03):
       ```
       AskUserQuestion(
         header: "⚠️ Triage <i>/<N_batches>",
         question: "<k> of <N> ⚠️ Uncertain findings. Pick a resolution for each:",
         options per entry, 3 each:
           - "✅ Verified — file is fine, audit-time uncertainty was unwarranted"
           - "🔴 Has bug — promote to a finding with severity {Critical|Major|Minor|Cosmetic}"
           - "Re-research — spawn one follow-up reviewer with deeper context (delay ~10 min)"
       )
       ```
    4. For each ✅ resolution: update the corresponding raw-return entry → verdict becomes ✅, append `operator_resolution: {timestamp, action: "verified"}`.
    5. For each 🔴 resolution: operator also selects severity (Critical/Major/Minor/Cosmetic per D-05/D-07). Orchestrator updates raw-return entry → verdict becomes 🔴 with that severity + `operator_resolution: {timestamp, action: "promoted-to-bug", severity: "..."}`.
    6. For each "Re-research" resolution: orchestrator spawns ONE additional gsd-code-reviewer task for that file (uses the scaffolding template from CONTEXT.md "Definitely include" section), with extra context = the prior reviewer's reasoning + what_would_settle_it. New return overwrites the prior raw-return entry. If the follow-up reviewer STILL returns ⚠️, re-ask operator with only the ✅/🔴 options (no second re-research allowed per DP-03).
    7. Loop until zero ⚠️ remain in any raw-return.
    8. Append an "Operator decision log" array to a holding buffer (NOT to AUDIT.md yet — that's atomic at synthesis time per DP-04). Each entry: `{file, original_uncertainty, action, severity?, timestamp}`.
    9. Print summary: "All ⚠️ resolved. <X> → ✅, <Y> → 🔴, <Z> required re-research." Hand off to Plan-agent Wave H.
  </how-to-verify>
  <resume-signal>"all-triage-complete" when zero ⚠️ remain in raw-returns/ and operator decision log buffered.</resume-signal>
</task>

<task type="auto" id="12.X.2">
  <name>Final synthesis — atomic AUDIT.md write (DP-04)</name>
  <files>.planning/AUDIT.md</files>
  <action>
    After Waves H1+H2+H3 complete, orchestrator merges in-memory ONE TIME and writes `.planning/AUDIT.md` atomically (NEVER incremental append per DP-04). The merge pulls from:
    - All 134 entries in `.planning/phases/12-codebase-audit-baseline/raw-returns/*.json` (post-checkpoint, so zero ⚠️).
    - Plan-agent output from Wave H1 (`12-08-PLAN.md`): try/catch sweep findings → embed as a CAT-NN section.
    - Plan-agent output from Wave H2 (`12-09-PLAN.md`): `12-tests-needed.md` exists at sibling path — AUDIT.md references it, does not duplicate.
    - Plan-agent output from Wave H3 (`12-10-PLAN.md`): `12-CHANNELS.md` exists at sibling path — AUDIT.md references it, does not duplicate.
    - Operator-decision log buffered during the checkpoint task above.

    **AUDIT.md structure** (one atomic write):
    ```markdown
    # Phase 12: Codebase Audit Baseline — AUDIT.md

    **Generated:** {ISO-8601 UTC}
    **Phase:** 12-codebase-audit-baseline
    **Coverage:** 134 files / 3 cross-cutting docs
    **Source verdicts:** {N_verified} ✅ Verified, {N_bugs} 🔴 Has bug, 0 ⚠️ Uncertain

    ## Sibling Documents
    - `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` — inter-component channel map
    - `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` — ranked test-coverage gaps

    ## Per-File Verdicts
    ### Wave A — lib/algorithm (12 files)
    #### {FILE_PATH} — {✅|🔴}
    {findings or "Verified, no findings."}
    {finding blocks for 🔴: ID + severity + 5 D-02 fields + cross-refs to CHN-NN if inter-component}
    ...repeat per file across all 7 waves...

    ## Cross-Cutting: try/catch sweep (CAT-NN)
    {flat table of every catch site: file:line | intentional/suspicious | caller-chain | notes}

    ## Operator Decision Log
    {table of every ⚠️ → ✅/🔴 resolution from the mid-execution checkpoint}

    ## Triage Table
    | Finding ID | File | Severity | Suggested Fix Phase |
    |-----------|------|----------|---------------------|
    | ALG-01 | lib/foo.ts:42 | Critical | 12.1 |
    | API-03 | app/api/bar/route.ts:18 | Major | 12.2 |
    | CMP-07 | components/Baz.tsx:120 | Minor | 12.3 |
    | ALG-09 | lib/qux.ts:88 | Cosmetic | backlog |
    ...
    ```

    **Severity → fix-phase mapping (per SPEC §8):**
    - Critical → 12.1
    - Major → 12.2
    - Minor → 12.3
    - Cosmetic → backlog (NOT a phase)

    Use the Write tool — never `cat << 'EOF'`.
  </action>
  <verify>
    <automated>test "$(grep -c '⚠️' .planning/AUDIT.md)" = "0" &amp;&amp; test "$(grep -cE '^#### .+ — (✅|🔴)' .planning/AUDIT.md)" -ge 134 &amp;&amp; grep -q '## Triage Table' .planning/AUDIT.md &amp;&amp; grep -q '## Operator Decision Log' .planning/AUDIT.md &amp;&amp; grep -q '## Cross-Cutting: try/catch sweep' .planning/AUDIT.md &amp;&amp; test -f .planning/phases/12-codebase-audit-baseline/12-CHANNELS.md &amp;&amp; test -f .planning/phases/12-codebase-audit-baseline/12-tests-needed.md &amp;&amp; test -z "$(git diff main -- dashboard-web supabase 2>/dev/null)"</automated>
  </verify>
  <done>AUDIT.md exists, ≥134 per-file verdict entries, zero ⚠️, triage table + decision log + try/catch sweep sections present, sibling docs exist, dashboard-web/ and supabase/ untouched on disk vs. main.</done>
</task>

</orchestrator_tasks>

<verification>
- `.planning/AUDIT.md` exists with ≥134 file-verdict entries.
- `grep -c "⚠️ Uncertain" .planning/AUDIT.md` returns `0`.
- `.planning/phases/12-codebase-audit-baseline/12-CHANNELS.md` has ≥5 sections.
- `.planning/phases/12-codebase-audit-baseline/12-tests-needed.md` has ≥10 ranked gaps + top-5 verification-blocking.
- AUDIT.md ends with bug triage table mapping every 🔴 to {12.1/12.2/12.3/backlog}.
- Operator decision log appended to AUDIT.md.
- `git diff main -- dashboard-web supabase` is empty.
- try/catch sweep entries embedded (or referenced sibling) labeling intentional/suspicious.
</verification>

<success_criteria>
All 8 SPEC.md acceptance criteria pass. Phase 12 documentation-only deliverable complete. Conditional Phase 12.x split derives from AUDIT.md triage table.
</success_criteria>

<output>
After completion, create `.planning/phases/12-codebase-audit-baseline/12-SUMMARY.md` summarizing wave counts, finding totals, severity distribution, and the proposed 12.x split.
</output>
</content>
</invoke>
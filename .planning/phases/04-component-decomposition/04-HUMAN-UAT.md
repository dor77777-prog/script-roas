---
status: partial
phase: 04-component-decomposition
source: [04-VERIFICATION.md]
started: 2026-05-19T01:35:00Z
updated: 2026-05-19T01:35:00Z
---

## Current Test

[awaiting human acceptance of 2 documented D-04 deviations + PH4-SMOKE formal re-confirmation]

## Tests

### 1. Accept D-04 line-cap deviation for CampaignsTable.tsx (1098L > 600L)
expected: User confirms further extraction would fragment table orchestration (sort/filter/optimization-toggle state + drawer mount + toolbar + AttributionGapPanel + KPI strip + thead). Per SUMMARY: "only the row JSX was a clean extraction point" (already done in T-C). Documented in 04-01-SUMMARY.md lines 99-105.
result: [pending]

### 2. Accept D-04 line-cap deviation for BillingSettings.tsx (994L > 600L)
expected: User confirms further extraction would fragment per-tab form state. Per SUMMARY: orchestrator function ~185L, remaining bulk is per-tab inline JSX (RecurringTab/OneTimeTab) — extracting them requires lifting form state up one level, which is out of Phase 4 ROADMAP scope. Tracked as a future refactor in PATTERNS.md. Documented in 04-01-SUMMARY.md lines 149-152.
result: [pending]

### 3. PH4-SMOKE — End-to-end manual smoke (per UI-SPEC §Manual Smoke Checklist, 13 items)
expected: 4 drawer panels render in order #6→#7→#8→#9 (Attribution → ProductChannel → MetaShopify → AdSetTable); Google campaign hides Attribution/ChannelBreakdown/Reconciliation; <5-day data hides Reconciliation; <3 mapped orders hides ChannelBreakdown; BillingSettings 3 tabs in order; CSV import 4-stage flow works (with new CR-01 fix for store-change duplicate recompute); cloud-sync propagates; date-range memo deps cover the right inputs; drawer-stack Esc behavior intact (WR-01); no trust-chip flicker on sort (IN5-01); P&L live-update fix (4f9cbb6) verified on Vercel deploy.
result: [pending — user has verified all 3 in-phase checkpoints in production; this is a formal record-keeping item]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

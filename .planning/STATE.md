---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: stack — INSERTED 2026-05-21
status: ready_to_plan
last_updated: "2026-05-21T06:26:20.421Z"
progress:
  total_phases: 19
  completed_phases: 9
  total_plans: 34
  completed_plans: 22
  percent: 47
---

## Accumulated Context

### Roadmap Evolution

- Phase 05.3 inserted after Phase 5: In-dashboard searchable user manual with live component examples (URGENT)
- Phase 05.4 inserted after Phase 05.3: Unmapped Active Campaigns Indicator (URGENT, operator UX)
- 2026-05-20: Phase 05.2.3.0 inserted between 05.2.1.1 and 05.4 — URGENT bug-fix for Shopify revenue not deducting refunds on prior-day orders. Phase 05.4 FROZEN pending 05.2.3.0 (the indicator must not ship over inflated revenue).
- 2026-05-24: Phase 9 added — Pre-Conversion Algorithmic Audit. Report-only phase that produces `.planning/AUDIT.md` classifying ~10 algorithmic surfaces as ✅ Verified / 🔴 Bug / ⚠️ Uncertain, with a bug-triage table mapping each finding to severity + suggested fix phase. No code changes; pre-flight for the conversion-funnel work that follows.
- 2026-05-24: Phase 10 added — Pre-Conversion Algorithmic Fixes. Acts on the triage from `.planning/AUDIT.md`: ships the one concrete 🔴 bug (B-01 cronLive tt return), 4 ⚠️ resolutions (U-01..U-06 minus cosmetic), and 4 verification-blocking test backfills (C-01..C-04). 2 parallel agents (source vs test), then 2 verification agents to confirm no other components were impacted.
- 2026-05-24: Phase 11 added — Decommission Apps Script tier. Operator confirmed Apps Script is fully dormant (Phase 05.7.0 set READ_FROM=postgres permanent). Removes: 10 .gs files at repo root, appsscript.json + .clasp.json, lib/sheets.ts (after moving isAllowedStateKey + StoreMetaRow type to a new home), readFrom() in featureFlags.ts, algorithm-parity.test.ts (AUDIT C-05). Cleans up documentation references in SETUP.md / SYSTEM_OVERVIEW.md / README.md. Single agent; verify with regression sweep.

# Dynamic salaries % + P&L tab reorder — approved design

**Date:** 2026-06-02
**Status:** APPROVED by operator (pending spec review). Brainstormed via the superpowers flow.
**Depends on / sequencing:** Lands AFTER Plan A (`plans/2026-06-02-plan-a-foundation-framing.md`) completes — Plan A is mid-execution and touches `PnLBreakdown.tsx` (T11 COGS prose, T18 MER note) + `analytics.ts`; doing this concurrently would conflict. Build this on top of the finished Plan A.

## Goal
Two P&L-tab changes that ship together:
1. **Dynamic salaries expense** — an editable salaries figure, **per-month + retroactive** like COGS, **business-level only**, that subtracts in **true net profit only** (not the hero operating profit). Replaces the current workaround of entering salaries as a BillingSettings recurring cost (operator: "not convenient, not smart").
2. **P&L tab reorder** — surface the result (Profit & Loss) right after the monthly goal; push the settings editors below.

## Locked decisions (from brainstorming)
- **Base / model:** each month's salaries value is EITHER a **% of revenue** (like COGS) OR a **fixed monthly CAD amount** — a per-entry toggle. Un-edited months use the **default = 7% (percent)**.
- **Grain:** business-level only (NO per-store mode). Per-month overrides + a default, with the same **4 apply-scopes** as COGS (current month / specific month / all-previous / everything).
- **Where it hits:** **true net profit ONLY** — a new "משכורות" line in the P&L cascade + KpiCards net, AFTER fixed costs. Does **NOT** change the hero "operating profit" (revenue − adSpend − COGS). Retroactive + immediate, client-side recompute, localStorage + cloud-synced (mirror `cogsSettings`/`cloudSync`).
- **Double-count guard:** the new editor is the SINGLE source for salaries. The panel shows a reminder — *"אם הזנת משכורות ב'עלויות קבועות' — הסר משם כדי לא לספור פעמיים."* No auto-detection (BillingSettings labels are free-text → can't reliably identify a salaries row).

## Architecture (mirror the COGS pattern)
- **`src/lib/salarySettings.ts`** — model + pure helpers. Shape:
  ```
  type SalaryEntry = { kind: 'percent' | 'amount'; value: number };
  type SalarySettings = { default: SalaryEntry; byMonth: Record<string /*YYYY-MM*/, SalaryEntry> };
  const DEFAULT_SALARY: SalaryEntry = { kind: 'percent', value: 7 };
  effectiveSalaryEntry(settings, month): SalaryEntry            // byMonth[month] ?? default
  applyPctToScope-equivalent applySalaryToScope(...)            // the 4 apply-scopes, business-only
  salariesForRange(settings, rows, range): number              // see computation below
  read/write + cloud sync (mirror cogsSettings)
  ```
- **`salariesForRange` computation** (reuses both existing cost patterns):
  for each month overlapping the selected range →
  - `percent` entry → `value% × (Σ revenue of that month's rows within range)` — revenue-based, auto-prorates (same idea as per-row COGS).
  - `amount` entry → `value × (days-of-that-month-inside-range ÷ days-in-month)` — day-prorated (same idea as `prorateFixedCosts`).
  Sum across months = salaries deduction for the range.
- **`src/lib/hooks/useSalarySettings.ts`** — reactive hook (mirror `useCogsSettings`); dispatches a `roas-salary-changed` event (mirror `roas-billing-changed`) so the dashboard re-aggregates.
- **`src/components/SalarySettings.tsx`** — panel mirroring `CogsSettings`: a default field + per-entry **percent/amount toggle**, the 4 apply-scopes, a **collapsible** per-month timeline (collapsed by default, "נערך"/"ברירת מחדל" badges), and the double-count reminder note. Business-only (no per-store toggle). Built to the 2026-06-01 readability standard (`<Money>`/`<Metric>`, tokens, light+dark).
- **Net-profit wiring:** subtract `salariesForRange(...)` wherever fixed costs are subtracted to reach **true net** — `analytics.ts` net computation + `PnLBreakdown.tsx` (new "משכורות" line in the cascade) + KpiCards net. The hero/operating-profit path is untouched. `GoalTracker` (revenue goal) is unaffected.

## P&L tab reorder (`Dashboard.tsx` `PnLTab`)
New order:
1. SectionIntro · PageScope · PageSynthesis · Filters *(unchanged)*
2. **GoalTracker** (יעד חודשי) *(unchanged position)*
3. **PnLBreakdown** (Profit & Loss) — **moved up to here, immediately after the goal**
4. Editors below, in order: **BillingSettings · CogsSettings · SalarySettings (new)**

## What is NOT touched (locked)
Hero operating profit · per-store Home cards + ROAS-band gradients · ROAS bands · the campaign↔store↔product mapping · CAPI (read-only; this is all local compute) · COGS feature behavior (salaries is a sibling, independent).

**P&L line preservation (no info loss):** salaries is added as a NEW line AFTER "הוצאות קבועות" and BEFORE "רווח נטו אמיתי". EVERY existing cascade line stays exactly as-is — including the presentational **"החזרים בתקופה"** line (which sits right after "הכנסות (נטו)", shows the refund total, and does NOT advance the running total because revenue is already net-of-refunds). The new full order: הכנסות (נטו) → החזרים בתקופה *(presentational)* → הוצאות פרסום → עלות סחורה (COGS) → עמלות עיבוד תשלום → הוצאות קבועות → **משכורות (new)** → רווח נטו אמיתי.

## Mockup before UI code
A mockup (light+dark, openable HTML) of: the SalarySettings panel (percent/amount toggle, default 7%, collapsed timeline, double-count note) + the **reordered P&L tab** + the new "משכורות" line in the P&L cascade. Operator approves the mockup before any UI code (per standing preference).

## Testing
- `salarySettings` pure helpers: effective entry resolution, the 4 apply-scopes, `salariesForRange` for percent / amount / mixed months / partial-month proration / default-7% fallback (node tests).
- `useSalarySettings` reactivity + persistence (dom test).
- `SalarySettings` panel: default 7% renders, percent↔amount toggle persists, apply-scopes write byMonth, timeline collapsed-by-default + expands, double-count note present (dom test).
- Net wiring: net profit drops by the salaries deduction; hero operating profit unchanged; default 7% reproduces a defined baseline (analytics test).
- P&L reorder: PnLBreakdown renders immediately after GoalTracker, editors below (dom test).

## Out of scope
Per-store salaries · affecting hero/operating profit · auto-migrating the old BillingSettings salaries entry · any platform/CAPI interaction.

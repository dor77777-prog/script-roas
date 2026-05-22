// Phase 05.7.4 — Build the 5-parameter array for the `roas_daily_summary`
// Meta template. TS port of `Notifications.gs:buildTemplateParameters_`
// at lines 347-386.
//
// Meta is strict about parameter count matching the {{N}} placeholders in
// the approved template. The `roas_daily_summary` template has exactly 5:
//   {{1}} = date + time title (e.g. "12:00, 20/05/2026")
//   {{2}} = store 1 block (or "—" if missing)
//   {{3}} = store 2 block (or "—" if missing)
//   {{4}} = store 3 block (or "—" if missing)
//   {{5}} = grand-totals block (or "אין נתונים זמינים" if no data)
//
// === CRITICAL: NO newlines / tabs / 5+ consecutive spaces inside a param ===
//
// 2026-05-21 first-pass shipped with `\n` separators inside each block (the
// Apps Script version's format from when it was used for freeform Twilio
// messages too). Meta rejected with error 132018:
//
//   "Param text cannot have new-line/tab characters or more than 4
//    consecutive spaces"
//
// Meta's approved template body ALREADY contains the blank lines BETWEEN
// {{N}} placeholders — each individual parameter must be a single-line
// string with inline separators. Format matches the user's original
// approved-template sample exactly:
//
//   🏪 uzoshop: • הוצאה: C$450 • הכנסות: C$1,890 • ROAS: 4.20 • הזמנות: 28  (פייסבוק: 18, גוגל: 6, אחרים: 4)
//
// Bullet separator: ` • ` (space-bullet-space). Order count + source
// breakdown keep the 2-space separator before the paren so the breakdown
// reads as a sub-clause (matches the sample on the approved template).

import type { DaySummary, StoreSummary } from './summary';

function formatRoas(roas: number): string {
  if (!Number.isFinite(roas) || roas === 0) return '—';
  return roas.toFixed(2);
}

function formatCad(amount: number): string {
  if (!Number.isFinite(amount)) return 'C$0';
  return 'C$' + Math.round(amount).toLocaleString('en-CA');
}

/**
 * Phase 05.7.x — CPM is reported with 2 decimals because the typical
 * value range is C$3-C$30 and operators care about sub-dollar moves
 * (a CPM creeping from C$6.40 → C$7.10 is the early-warning signal
 * for creative fatigue). Empty / zero impressions → '—' so the message
 * doesn't read "CPM: C$0" when impressions data is missing.
 */
function formatCpm(cpm: number): string {
  if (!Number.isFinite(cpm) || cpm <= 0) return '—';
  return 'C$' + cpm.toFixed(2);
}

// Phase 05.7.5 (2026-05-22): tiktok-paid orders are tracked as a separate
// bucket in `StoreSummary`, but the approved Meta WhatsApp template still
// has only 3 source slots — פייסבוק / גוגל / אחרים. Phase D will submit
// a new template with a 4th slot for טיקטוק; until then, we COMBINE
// tiktok-paid into "אחרים" so the WhatsApp output stays consistent with
// the prior count (no mysterious shift in "אחרים" once tiktok-paid starts
// classifying orders out of it).
function combinedOther(other: number, tiktok: number): number {
  return other + tiktok;
}

function storeBlock(s: StoreSummary): string {
  // Phase 05.7.x — appended `• CPM: C$X.XX` after ROAS. Position chosen
  // to keep the cost-side metrics (Spend → ROAS → CPM) clustered before
  // the volume-side (orders + breakdown). No Meta template change
  // required — the strings inside {{N}} placeholders are operator-set.
  return (
    '🏪 ' +
    s.storeName +
    ': • הוצאה: ' +
    formatCad(s.totalSpend) +
    ' • הכנסות: ' +
    formatCad(s.revenue) +
    ' • ROAS: ' +
    formatRoas(s.roas) +
    ' • CPM: ' +
    formatCpm(s.cpm) +
    ' • הזמנות: ' +
    s.orders +
    '  (פייסבוק: ' +
    s.facebook +
    ', גוגל: ' +
    s.google +
    ', אחרים: ' +
    combinedOther(s.other, s.tiktok) +
    ')'
  );
}

function totalsBlock(t: DaySummary['totals']): string {
  return (
    '🎯 סה"כ: • הוצאה: ' +
    formatCad(t.spend) +
    ' • הכנסות: ' +
    formatCad(t.revenue) +
    ' • ROAS: ' +
    formatRoas(t.roas) +
    ' • CPM: ' +
    formatCpm(t.cpm) +
    ' • הזמנות: ' +
    t.orders +
    '  (פייסבוק: ' +
    t.facebook +
    ', גוגל: ' +
    t.google +
    ', אחרים: ' +
    combinedOther(t.other, t.tiktok) +
    ')'
  );
}

/**
 * Build the 5-element parameter array for the approved Meta template.
 *
 * Store order follows the summary.stores insertion order. When fewer than
 * 3 stores have rows for the requested date, the missing slots receive
 * "—" so the template always gets exactly 5 parameters (Meta rejects
 * partial parameter lists).
 */
export function buildTemplateParameters(
  summary: DaySummary | null,
  title: string,
): string[] {
  const params: string[] = [title];
  const storeIds = summary && summary.stores ? Object.keys(summary.stores) : [];
  for (let i = 0; i < 3; i++) {
    const sid = storeIds[i];
    if (sid && summary) {
      params.push(storeBlock(summary.stores[sid]));
    } else {
      params.push('—');
    }
  }
  if (summary && summary.totals) {
    params.push(totalsBlock(summary.totals));
  } else {
    params.push('אין נתונים זמינים');
  }
  return params;
}

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
// The block format is a 5-line Hebrew bullet list — see `storeBlock` /
// `totalsBlock` below.

import type { DaySummary, StoreSummary } from './summary';

function formatRoas(roas: number): string {
  if (!Number.isFinite(roas) || roas === 0) return '—';
  return roas.toFixed(2);
}

function formatCad(amount: number): string {
  if (!Number.isFinite(amount)) return 'C$0';
  return 'C$' + Math.round(amount).toLocaleString('en-CA');
}

function storeBlock(s: StoreSummary): string {
  return (
    '🏪 ' +
    s.storeName +
    ':\n' +
    '• הוצאה: ' +
    formatCad(s.totalSpend) +
    '\n' +
    '• הכנסות: ' +
    formatCad(s.revenue) +
    '\n' +
    '• ROAS: ' +
    formatRoas(s.roas) +
    '\n' +
    '• הזמנות: ' +
    s.orders +
    '  (פייסבוק: ' +
    s.facebook +
    ', גוגל: ' +
    s.google +
    ', אחרים: ' +
    s.other +
    ')'
  );
}

function totalsBlock(t: DaySummary['totals']): string {
  return (
    '🎯 סה"כ:\n' +
    '• הוצאה: ' +
    formatCad(t.spend) +
    '\n' +
    '• הכנסות: ' +
    formatCad(t.revenue) +
    '\n' +
    '• ROAS: ' +
    formatRoas(t.roas) +
    '\n' +
    '• הזמנות: ' +
    t.orders +
    '  (פייסבוק: ' +
    t.facebook +
    ', גוגל: ' +
    t.google +
    ', אחרים: ' +
    t.other +
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

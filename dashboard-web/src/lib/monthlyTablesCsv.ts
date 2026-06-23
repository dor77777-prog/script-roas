// dashboard-web/src/lib/monthlyTablesCsv.ts
//
// Step 6 — pure CSV builder for the Monthly (Archive) tables export. Serializes
// the CURRENTLY-shown daily rows (already store/month-filtered by the caller)
// into Hebrew-headed CSV cells. The thin browser side-effect (blob download)
// lives in the shared lib/csvExport.ts (toCsv + downloadCsv); this module is
// pure so the header order + cell formatting are unit-testable.

import type { DailyRow } from '@/lib/types';

// NOTE: cells use a plain `toFixed(2)` (not he-IL `formatNumber`) on purpose —
// he-IL groups digits with commas, which would corrupt the CSV columns.

/** Hebrew header row, canonical column order. Exported for the test lock. */
export const MONTHLY_CSV_HEADERS = [
  'תאריך',
  'חנות',
  'הוצאה FB',
  'הוצאה GA',
  'הוצאה TT',
  'סה"כ הוצאה',
  'הכנסה',
  'ROAS',
  'רווח נקי',
] as const;

/** 2-decimal he-IL number WITHOUT digit grouping — CSV stays machine-parseable
 *  (a thousands separator would inject commas that break the column split). */
function num(n: number): string {
  return n.toFixed(2);
}

export type MonthlyCsv = { headers: string[]; rows: string[][] };

/**
 * Build the headers + serialized rows for the monthly CSV export. Rows are
 * sorted by date ascending, then store name, so the export reads chronologically
 * regardless of the on-screen grouping. Net profit is left blank (not "0") on
 * rows without COGS so the export doesn't imply a real zero profit.
 */
export function buildMonthlyCsv(daily: DailyRow[]): MonthlyCsv {
  const sorted = [...daily].sort(
    (a, b) => a.date.localeCompare(b.date) || a.storeName.localeCompare(b.storeName),
  );
  const rows = sorted.map((r) => [
    r.date,
    r.storeName,
    num(r.fbSpend),
    num(r.gaSpend),
    num(r.ttSpend ?? 0),
    num(r.totalSpend),
    num(r.revenue),
    num(r.totalSpend > 0 ? r.revenue / r.totalSpend : 0),
    r.hasCogs ? num(r.netProfit) : '',
  ]);
  return { headers: [...MONTHLY_CSV_HEADERS], rows };
}

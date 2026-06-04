// dashboard-web/src/lib/csvExport.ts
//
// ux-csv-export (Wave 1) — pure CSV serialization + a browser download trigger.
// Pure `toCsv` is unit-tested; `downloadCsv` is the thin browser side-effect.
// Used by table toolbars (Campaigns/Products/Ads) to export the CURRENT
// (filtered + sorted) rows the operator is looking at.

type Cell = string | number | null | undefined;

/** RFC-4180-ish: quote a field that contains a comma, quote, or newline; double inner quotes. */
function escapeCell(v: Cell): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize headers + rows to a CSV string (no trailing newline). */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
}

/** Trigger a browser download of `csv` as `filename`. Prepends a UTF-8 BOM so
 *  Excel renders Hebrew + special chars correctly. No-op outside the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

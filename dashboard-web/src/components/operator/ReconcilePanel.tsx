'use client';

// dashboard-web/src/components/operator/ReconcilePanel.tsx
//
// DQ-1 ReconcilePanel — operator data-quality surface (Wave 3 "data-trust").
//
// Exposes the live reconciliation harness that already runs behind
// `npm run audit:reconcile` (INV-7/9/10 cross-source checks + INV-3/6 same-
// source checks). Self-fetches GET /api/operator/reconcile every 15 s and
// renders one of two states, per the approved mockup
// (docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html):
//
//   • violations.length === 0 → a calm green "✓ הכל תואם — כל הבדיקות עברו"
//     line (text-status-greenFg, with a soft live pulse dot).
//   • else                    → a TableBase of
//       בדיקה · חנות·פלטפורמה · תאריך · צפוי · בפועל · פער
//     Numeric cells render through the shared <Money> primitive (tabular-nums,
//     overflow-safe, RTL-isolated) right-aligned; the delta is coloured with
//     the paired text-status-warningFg on-color token so it clears AA in both
//     themes (never a text-color-from-band).
//
// 100 % token-driven (bg-status-*/text-status-*Fg + ink-*), full light+dark via
// the tokens, RTL/logical classes only (ms-/ps-/start-/end-).

import useSWR from 'swr';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import type { ReconcileResponse } from '@/app/api/reconcile/route';
import type { Violation } from '@/lib/audit/reconcile';
import {
  TableBase,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/TableBase';
import { Money } from '@/components/ui/Money';

const ENDPOINT = '/api/reconcile';

// ---------------------------------------------------------------------------
// Violation → table-column parser.
//
// The harness encodes its findings as { label, detail, values? }. We project
// each into the six display columns the mockup asks for. Everything is
// defensive: a label/detail we can't parse still renders (raw label as the
// "check", "—" for the unparsable numeric cells) rather than throwing.
// ---------------------------------------------------------------------------

const DATE_RE = /(\d{1,2}\/\d{1,2})/; // DD/MM tag embedded in the label.
const NUM_RE = /-?\d+(?:[.,]\d+)?/g; // grabs numbers out of `detail`.

interface ParsedViolation {
  key: string;
  /** "INV-7 Meta spend" — the leading check phrase, date/store stripped. */
  check: string;
  /** "uzoshop · Meta" — store (+ platform when the label names one). */
  storePlatform: string;
  /** "30/05" or "—". */
  date: string;
  expected: number | null;
  actual: number | null;
  /** actual − expected when both known, else null. */
  delta: number | null;
}

const PLATFORM_RE = /\b(Meta|Google|TikTok)\b/;

function parseViolation(v: Violation, index: number): ParsedViolation {
  const label = v.label ?? '';

  // The harness tags the cell as `${DD/MM}/${store}` at the END of the label
  // (e.g. "INV-7 Meta spend 30/05/uzoshop"). Pull the date, then the store is
  // whatever follows the date's trailing slash.
  let date = '—';
  let store = '';
  let check = label;
  const dateMatch = label.match(DATE_RE);
  if (dateMatch) {
    date = dateMatch[1];
    const after = label.slice((dateMatch.index ?? 0) + dateMatch[1].length);
    // after looks like "/uzoshop" (cross-source) or "/uzoshop" too for agree().
    store = after.replace(/^\//, '').trim();
    check = label.slice(0, dateMatch.index).trim();
  }

  // Platform, when the check phrase names one (INV-7 Meta/Google/TikTok spend).
  const platMatch = check.match(PLATFORM_RE);
  const platform = platMatch ? platMatch[1] : '';

  const storePlatform =
    store && platform ? `${store} · ${platform}` : store || platform || '—';

  // expected / actual:
  //   1. agree() violations carry a `values` map (src0, src1, …). Use the
  //      first two as expected/actual.
  //   2. cross-source (INV-7/9/10) put two numbers in `detail` ("X vs Y").
  let expected: number | null = null;
  let actual: number | null = null;

  if (v.values) {
    const nums = Object.values(v.values).filter((n) => Number.isFinite(n));
    if (nums.length >= 1) expected = nums[0];
    if (nums.length >= 2) actual = nums[1];
  }
  if (expected == null || actual == null) {
    const found = (v.detail ?? '').match(NUM_RE);
    if (found && found.length >= 2) {
      const a = Number(found[0].replace(/,/g, ''));
      const b = Number(found[1].replace(/,/g, ''));
      if (expected == null && Number.isFinite(a)) expected = a;
      if (actual == null && Number.isFinite(b)) actual = b;
    }
  }

  const delta =
    expected != null && actual != null && Number.isFinite(actual - expected)
      ? actual - expected
      : null;

  return {
    key: `${label}::${index}`,
    check: check || label || 'בדיקה',
    storePlatform,
    date,
    expected,
    actual,
    delta,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReconcilePanel() {
  const { data } = useSWR<ReconcileResponse | null>(ENDPOINT, fetchJsonOrNull, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });

  // null (pending / soft-failed fetch) is treated as "no known violations" so
  // the operator never sees a scary table flash before the first tick lands.
  const violations = data?.violations ?? [];

  if (violations.length === 0) {
    return (
      <div className="flex items-center gap-2.5 py-1.5 ps-0.5 text-sm font-semibold text-status-greenFg">
        <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 rounded-pill bg-status-green opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-pill bg-status-green" />
        </span>
        <span>✓ הכל תואם — כל הבדיקות עברו</span>
      </div>
    );
  }

  const rows = violations.map(parseViolation);

  return (
    <div className="overflow-x-auto">
      <TableBase className="text-xs sm:text-sm">
        <TableHead>
          <TableRow>
            <TableHeaderCell>בדיקה</TableHeaderCell>
            <TableHeaderCell>חנות · פלטפורמה</TableHeaderCell>
            <TableHeaderCell>תאריך</TableHeaderCell>
            <TableHeaderCell numeric>צפוי</TableHeaderCell>
            <TableHeaderCell numeric>בפועל</TableHeaderCell>
            <TableHeaderCell numeric>פער</TableHeaderCell>
          </TableRow>
        </TableHead>
        <tbody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs text-ink">{r.check}</TableCell>
              <TableCell className="text-ink-secondary">{r.storePlatform}</TableCell>
              <TableCell className="text-ink-secondary">
                <bdi dir="ltr">{r.date}</bdi>
              </TableCell>
              <TableCell numeric className="text-ink">
                {r.expected != null ? <Money value={r.expected} prefix="none" /> : '—'}
              </TableCell>
              <TableCell numeric className="text-ink">
                {r.actual != null ? <Money value={r.actual} prefix="none" /> : '—'}
              </TableCell>
              <TableCell numeric>
                {r.delta != null ? (
                  <span className="text-status-warningFg">
                    <Money value={r.delta} prefix="none" />
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </TableBase>
    </div>
  );
}

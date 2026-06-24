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

import { useState } from 'react';
import useSWR from 'swr';
import { CheckCircle2, AlertTriangle, Check, Undo2 } from 'lucide-react';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import type { ReconcileResponse } from '@/app/api/reconcile/route';
import type { Violation } from '@/lib/audit/reconcile';
import { bannerViolations } from '@/lib/audit/reconcileRows';
import {
  isFindingAcked,
  reconcileAckKey,
  type ReconcileAcks,
} from '@/lib/audit/reconcileAck';
import { useReconcileAcks } from '@/lib/hooks/useReconcileAcks';
import {
  TableBase,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/TableBase';
import { Money } from '@/components/ui/Money';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const ENDPOINT = '/api/reconcile';

// ---------------------------------------------------------------------------
// Violation → table-column parser.
//
// The harness encodes its findings as { label, detail, values? }. We project
// each into the six display columns the mockup asks for. Everything is
// defensive: a label/detail we can't parse still renders (raw label as the
// "check", "—" for the unparsable numeric cells) rather than throwing.
// ---------------------------------------------------------------------------

const TAG_RE = /\s(\d{4}-\d{2}-\d{2})\/(.+?)\s*$/; // trailing " YYYY-MM-DD/store" (store may contain spaces).
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
  /** Known-explainable gap (INV-9 custom-item refunds) — shown muted as "מוסבר". */
  soft: boolean;
}

const PLATFORM_RE = /\b(Meta|Google|TikTok)\b/;

function parseViolation(v: Violation, index: number): ParsedViolation {
  const label = v.label ?? '';

  // The harness tags the cell at the END of the label as " YYYY-MM-DD/store"
  // (e.g. "INV-9 product vs data revenue 2026-05-31/Zol Plus"). Parse the FULL
  // ISO date + the store after the slash (store may contain spaces). The earlier
  // /(\d{1,2}\/\d{1,2})/ matched INSIDE the ISO date ("…05-31/360usmile" →
  // "31/36" + "0usmile"), garbling both columns.
  let date = '—';
  let store = '';
  let check = label;
  const m = label.match(TAG_RE);
  if (m && m.index !== undefined) {
    const iso = m[1];
    const [, mo, d] = iso.split('-');
    date = `${d}/${mo}`;
    store = m[2].trim();
    check = label.slice(0, m.index).trim();
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
    soft: Boolean(v.soft),
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
  // DQ-1 "mark reviewed": acks are a cloud-synced dashboard_state key, applied
  // CLIENT-SIDE to the fetched findings (consistent with how campaignProductMap
  // is a synced key the client applies to fetched data; the /api/reconcile
  // route stays stateless + shared by the Home banner). An ack HIDES the finding
  // while ~unchanged and re-pops on a new date or material worsening.
  const { acks, ack, unack } = useReconcileAcks();
  const [showReviewed, setShowReviewed] = useState(false);

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
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        <span>הכל תואם — כל הבדיקות עברו</span>
      </div>
    );
  }

  // Split into MATERIAL (hard, likely-real, ≥10% or no-relGap) vs EXPLAINED
  // (soft INV-9 custom-item gaps + sub-threshold). Lead with the verdict and
  // collapse the explained list so a long row of "known" gaps doesn't read as
  // alarming — the same materiality the Home banner uses.
  const material = bannerViolations(violations);
  const materialSet = new Set(material);
  const explained = violations.filter((v) => !materialSet.has(v));

  // Within the material list, peel off the acked findings (hidden by default;
  // revealable via the "show reviewed" toggle). Only material findings carry
  // an ack control — explained/soft gaps are already collapsed + never alarm.
  const activeMaterial = material.filter((v) => !isFindingAcked(v, acks));
  const ackedMaterial = material.filter((v) => isFindingAcked(v, acks));

  return (
    <div className="space-y-3">
      {activeMaterial.length === 0 ? (
        <div className="flex items-center gap-2.5 py-1.5 ps-0.5 text-sm font-semibold text-status-greenFg">
          <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 rounded-pill bg-status-green opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-pill bg-status-green" />
          </span>
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          <span>אין אי-התאמות מהותיות — כל המקורות תואמים בתחום הסביר</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-status-warningFg">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span>{activeMaterial.length} אי-התאמות מהותיות דורשות בדיקה</span>
          </div>
          <ReconcileTable list={activeMaterial} acks={acks} onAck={ack} onUnack={unack} />
        </>
      )}

      {/* DQ-1 — reviewed/acked material findings: hidden by default, with a
          toggle to review them + an un-ack control so an ack is never a trap. */}
      {ackedMaterial.length > 0 && (
        <div className="text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowReviewed((s) => !s)}
            aria-expanded={showReviewed}
          >
            {showReviewed ? 'הסתר שנבדקו' : 'הצג שנבדקו'} (
            <bdi dir="ltr" className="tabular-nums">{ackedMaterial.length}</bdi>)
          </Button>
          {showReviewed && (
            <div className="mt-2">
              <ReconcileTable list={ackedMaterial} acks={acks} onAck={ack} onUnack={unack} reviewed />
            </div>
          )}
        </div>
      )}

      {explained.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">
            הצג {explained.length} פערים מוסברים (הפרשי custom-item / החזרים — תקינים, ARCHITECTURE §14.7)
          </summary>
          <div className="mt-2">
            <ReconcileTable list={explained} acks={acks} onAck={ack} onUnack={unack} />
          </div>
        </details>
      )}
    </div>
  );
}

/** The reconcile table for a list of violations. When `reviewed` the action
 *  column offers "בטל סימון" (un-ack); otherwise "✓ סמן כנבדק" (ack). */
function ReconcileTable({
  list,
  acks,
  onAck,
  onUnack,
  reviewed = false,
}: {
  list: Violation[];
  acks: ReconcileAcks;
  onAck: (v: Violation) => void;
  onUnack: (fingerprint: string) => void;
  reviewed?: boolean;
}) {
  const rows = list.map((v, i) => ({ v, parsed: parseViolation(v, i) }));
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
            <TableHeaderCell>פעולה</TableHeaderCell>
          </TableRow>
        </TableHead>
        <tbody>
          {rows.map(({ v, parsed: r }) => (
            <TableRow key={r.key}>
              <TableCell className="font-mono text-xs text-ink">
                <span className="inline-flex items-center gap-1.5">
                  {r.check}
                  {r.soft && (
                    <Badge tone="gray" className="font-sans">
                      מוסבר
                    </Badge>
                  )}
                </span>
              </TableCell>
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
              <TableCell>
                {reviewed || isFindingAcked(v, acks) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onUnack(reconcileAckKey(v))}
                  >
                    <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    בטל סימון
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onAck(v)}
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    סמן כנבדק
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </TableBase>
    </div>
  );
}

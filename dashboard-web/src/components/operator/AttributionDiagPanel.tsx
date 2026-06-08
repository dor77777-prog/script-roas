'use client';

// dashboard-web/src/components/operator/AttributionDiagPanel.tsx
//
// classify-v2 T4 — re-runnable attribution diagnostic panel.
//
// Renders the live source-distribution analysis the operator wants to keep
// re-running over time to see whether the classifier (classify-v2) has more to
// expand. Self-fetches GET /api/operator/attribution-diag via operatorFetch +
// SWR (default last 30 days), and shows:
//
//   • Orders source distribution  (count + pct per `source`)
//   • ATC source distribution     (count + pct per `source`)
//   • Murky-bucket breakdowns:
//       - other-paid     → top "utm_source | utm_medium" combos
//       - other-referral → top referrer domains
//       - direct         → first_touch_source breakdown
//   • First-touch coverage        (orders + ATC)
//
// Source labels come from the shared sourceLabels vocabulary (SOURCE_LABEL) so
// the diagnostic never drifts from the activity-feed badge / AI-report wording.
//
// 100% token-driven (bg-glass-*/text-ink-*/text-status-*Fg), full light+dark via
// the tokens, RTL/logical classes only (ms-/ps-/start-/end-), counts + pct via
// tabular-nums (overflow-safe, never clipped). Mobile-first: each section is its
// own Card and the tables scroll horizontally inside their own overflow box.

import useSWR, { useSWRConfig } from 'swr';
import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { fmtCount } from '@/lib/format';
import { SOURCE_LABEL } from '@/lib/sourceLabels';
import type { OrderSource } from '@/lib/ordersAttribution';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Heading, Text } from '@/components/ui/Typography';
import {
  TableBase,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '@/components/ui/TableBase';
import type {
  AttributionDiagResponse,
  SourceCount,
} from '@/app/api/operator/attribution-diag/route';

const ENDPOINT = '/api/operator/attribution-diag';

async function fetcher(url: string): Promise<AttributionDiagResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as AttributionDiagResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hebrew label for a classifier `source`. '' (unknown) → a distinct chip.
 *  Unknown/future labels fall back to the raw string (survive, not vanish). */
function labelFor(source: string): string {
  if (source === '') return 'לא ידוע / חסר';
  return SOURCE_LABEL[source as Exclude<OrderSource, ''>] ?? source;
}

/** "60.0%" — one decimal, tabular, never clipped. */
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DistributionTable({
  title,
  hint,
  total,
  rows,
}: {
  title: string;
  hint: string;
  total: number;
  rows: SourceCount[];
}) {
  return (
    <Card className="p-4">
      <Heading level="panel" className="mb-1 flex flex-wrap items-baseline gap-2">
        <span>{title}</span>
        <span className="text-ink-secondary text-xs font-normal">
          ({fmtCount(total)} סה״כ)
        </span>
      </Heading>
      <Text tone="muted" className="mb-3 block text-xs">
        {hint}
      </Text>
      {rows.length === 0 ? (
        <Text tone="secondary" className="block text-sm">
          אין נתונים בטווח שנבחר.
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <TableBase className="text-xs sm:text-sm">
            <TableHead>
              <TableRow>
                <TableHeaderCell>מקור</TableHeaderCell>
                <TableHeaderCell numeric>כמות</TableHeaderCell>
                <TableHeaderCell numeric>אחוז</TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.source || '∅'}>
                  <TableCell>
                    <span className="font-medium">{labelFor(r.source)}</span>
                    <bdi
                      dir="ltr"
                      className="text-ink-muted ms-2 font-mono text-2xs"
                    >
                      {r.source || '∅'}
                    </bdi>
                  </TableCell>
                  <TableCell numeric>{fmtCount(r.count)}</TableCell>
                  <TableCell numeric>{pct(r.pct)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </TableBase>
        </div>
      )}
    </Card>
  );
}

function BucketTable({
  title,
  hint,
  keyHeader,
  rows,
  emptyText,
}: {
  title: string;
  hint: string;
  keyHeader: string;
  rows: { key: string; count: number }[];
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <Heading level="panel" className="mb-1">
        {title}
      </Heading>
      <Text tone="muted" className="mb-3 block text-xs">
        {hint}
      </Text>
      {rows.length === 0 ? (
        <Text tone="secondary" className="block text-sm">
          {emptyText}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <TableBase className="text-xs sm:text-sm">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{keyHeader}</TableHeaderCell>
                <TableHeaderCell numeric>כמות</TableHeaderCell>
              </TableRow>
            </TableHead>
            <tbody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <bdi dir="ltr" className="font-mono text-2xs sm:text-xs">
                      {r.key}
                    </bdi>
                  </TableCell>
                  <TableCell numeric>{fmtCount(r.count)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </TableBase>
        </div>
      )}
    </Card>
  );
}

function CoverageStat({
  label,
  cov,
}: {
  label: string;
  cov: { withFt: number; total: number; pct: number };
}) {
  return (
    <div className="rounded-md border border-glass-edge bg-glass-1 px-4 py-3">
      <Text tone="secondary" className="block text-xs">
        {label}
      </Text>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-ink text-2xl font-semibold tabular-nums">{pct(cov.pct)}</span>
        <span className="text-ink-muted text-xs">
          ({fmtCount(cov.withFt)} / {fmtCount(cov.total)})
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AttributionDiagPanel() {
  const { data, isLoading } = useSWR<AttributionDiagResponse>(ENDPOINT, fetcher, {
    refreshInterval: 0, // re-run on demand — this is a diagnostic, not a live feed.
    revalidateOnFocus: false,
  });
  const { mutate } = useSWRConfig();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await mutate(ENDPOINT);
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading && !data) {
    return <p className="text-ink-secondary text-sm">טוען אבחון סיווג…</p>;
  }

  const diag = data;
  if (!diag) {
    return <p className="text-ink-secondary text-sm">אין נתוני אבחון זמינים.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header: range + manual refresh. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text tone="secondary" className="text-sm tabular-nums">
          טווח:{' '}
          <bdi dir="ltr" className="font-mono">
            {diag.range.from} → {diag.range.to}
          </bdi>
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          data-testid="attribution-diag-refresh"
          aria-label="הרץ מחדש את האבחון"
          className="gap-1.5"
        >
          <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          הרץ מחדש
        </Button>
      </div>

      {diag.error && (
        <p
          role="alert"
          className="rounded-md border border-status-red bg-status-redBg px-3 py-2 text-sm text-status-redFg"
        >
          שגיאה בטעינת האבחון: {diag.error}
        </p>
      )}

      {/* First-touch coverage — the metric that justifies the beacon work. */}
      <Card className="p-4">
        <Heading level="panel" className="mb-1">
          כיסוי first-touch
        </Heading>
        <Text tone="muted" className="mb-3 block text-xs">
          אחוז ההזמנות / ATC שנושאות אות first-touch (מצדיק את עבודת ה-beacon).
        </Text>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CoverageStat label="הזמנות" cov={diag.firstTouchCoverage.orders} />
          <CoverageStat label="הוספות לעגלה (ATC)" cov={diag.firstTouchCoverage.atc} />
        </div>
      </Card>

      {/* Distributions — orders + ATC, side by side on desktop. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DistributionTable
          title="התפלגות מקור — הזמנות"
          hint="ספירה ואחוז לכל ערך source ב-orders_attribution."
          total={diag.orders.total}
          rows={diag.orders.bySource}
        />
        <DistributionTable
          title="התפלגות מקור — ATC"
          hint="ספירה ואחוז לכל ערך source ב-store_events (add_to_cart)."
          total={diag.atc.total}
          rows={diag.atc.bySource}
        />
      </div>

      {/* Murky-bucket breakdowns — where the expansion opportunities hide. */}
      <div className="space-y-4">
        <Heading level="hero" className="flex items-center gap-2">
          <span>פירוק דליים עמומים</span>
          <span className="text-ink-secondary text-xs font-normal">
            (כאן מסתתרות הזדמנויות ההרחבה של הסיווג)
          </span>
        </Heading>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BucketTable
            title="other-paid"
            hint="צירופי utm_source | utm_medium לא מזוהים (שותפים / משפיענים)."
            keyHeader="utm_source | utm_medium"
            rows={diag.buckets.otherPaid}
            emptyText="אין שורות other-paid בטווח."
          />
          <BucketTable
            title="other-referral"
            hint="דומיינים מפנים מובילים (host בלבד)."
            keyHeader="דומיין"
            rows={diag.buckets.otherReferral.map((b) => ({ key: b.domain, count: b.count }))}
            emptyText="אין שורות other-referral בטווח."
          />
          <BucketTable
            title="direct"
            hint="האם הזמנות 'ישיר' נושאות first-touch (לפי first_touch_source)."
            keyHeader="first_touch_source"
            rows={diag.buckets.directFirstTouch.map((b) => ({ key: b.firstTouch, count: b.count }))}
            emptyText="אין שורות direct בטווח."
          />
        </div>
      </div>
    </div>
  );
}

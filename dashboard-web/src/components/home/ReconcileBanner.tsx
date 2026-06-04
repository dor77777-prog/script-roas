'use client';

// DQ-1 — ReconcileBanner (Home). A slim, self-fetching banner that surfaces
// data-source reconciliation violations (the INV-7/9/10 harness that already
// runs via `npm run audit:reconcile`) at the top of Home. It is INVISIBLE by
// default — only when the operator-reconcile endpoint reports one or more
// violations does the banner appear, nudging to /operator for the breakdown.
//
// Mockup: docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html (DQ-1).
// Token-driven (Badge `warning` tone + accent-link anchor), full light+dark via
// tokens, RTL/logical classes only, WCAG-AA in both themes (paired on-color
// foreground tokens — never text-color-from-band).

import useSWR from 'swr';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const KEY = '/api/reconcile';

export interface ReconcileViolation {
  check: string;
  storeName?: string;
  platform?: string;
  date?: string;
  expected?: number;
  actual?: number;
  delta?: number;
  detail?: string;
}

export interface ReconcileResponse {
  violations: ReconcileViolation[];
  error?: string;
}

export function ReconcileBanner() {
  const { data } = useSWR<ReconcileResponse | null>(KEY, fetchJsonOrNull, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });

  // Quiet by default: nothing while loading, errored, or all-clear.
  if (!data || !Array.isArray(data.violations) || data.violations.length === 0) {
    return null;
  }

  const n = data.violations.length;

  return (
    <Card
      data-testid="reconcile-banner"
      role="alert"
      className="flex items-center gap-3 px-4 py-3"
    >
      <Badge tone="warning">אי-התאמה</Badge>
      <span className="text-sm text-ink">
        נמצאו <bdi dir="ltr">{n}</bdi> אי-התאמות בין מקורות-הנתונים
      </span>
      <a
        href="/operator"
        data-testid="reconcile-banner-link"
        className="ms-auto whitespace-nowrap text-xs font-bold text-[color:var(--accent-link)] hover:underline"
      >
        לפרטים: /operator ←
      </a>
    </Card>
  );
}

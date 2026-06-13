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
import { ArrowLeft } from 'lucide-react';
import { fetchJsonOrNull } from '@/lib/fetchJson';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { bannerViolations } from '@/lib/audit/reconcileRows';
import type { Violation } from '@/lib/audit/reconcile';

const KEY = '/api/reconcile';

export interface ReconcileResponse {
  violations: Violation[];
  error?: string;
}

export function ReconcileBanner() {
  const { data } = useSWR<ReconcileResponse | null>(KEY, fetchJsonOrNull, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  });

  // Quiet by default: nothing while loading or errored. And crucially, alarm
  // ONLY on MATERIAL/hard discrepancies — soft known gaps (INV-9 custom-item
  // refunds) + sub-threshold gaps stay in the operator panel, not the Home
  // banner. So a clean-but-soft window shows no banner at all.
  const material = data && Array.isArray(data.violations) ? bannerViolations(data.violations) : [];
  if (material.length === 0) {
    return null;
  }

  const n = material.length;

  return (
    <Card
      data-testid="reconcile-banner"
      role="alert"
      className="flex items-center gap-3 px-4 py-3"
    >
      <Badge tone="warning">אי-התאמה</Badge>
      <span className="text-fs-sm text-ink">
        נמצאו <bdi dir="ltr" className="tabular-nums">{n}</bdi> אי-התאמות בין מקורות-הנתונים
      </span>
      <a
        href="/operator"
        data-testid="reconcile-banner-link"
        className="ms-auto inline-flex items-center gap-1 whitespace-nowrap text-fs-xs font-bold text-[color:var(--accent-link)] hover:underline"
      >
        לפרטים: /operator
        <ArrowLeft size={13} aria-hidden className="flex-none" />
      </a>
    </Card>
  );
}

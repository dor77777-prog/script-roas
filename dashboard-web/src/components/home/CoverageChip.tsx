'use client';

import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HelpTooltip } from '@/components/ui/Tooltip';
import type { CoverageChip as CoverageChipData } from '@/lib/home/adapters';

const TOOLTIP =
  'אחוז ההזמנות שנושאות סימן ייחוס (click-id / UTM). ה"לא ידוע" הנותר הוא לרוב ' +
  'תשלום מהיר (express checkout), חנות headless / draft, תנועה לא מתויגת, או ' +
  'פרמטרים שנחתכו ע״י פרטיות הדפדפן. ערוצים + לא-ידוע = 100% — לעולם לא מחולק מחדש.';

/**
 * Honest attribution-coverage chip — HERO ONLY (never on per-store cards).
 * Quiet by default (muted ink, no border); visually prominent only when the
 * unknown share is bad (> 30%). Renders nothing when there are no orders.
 * Numbers go through token-driven styling per the 2026-06-01 readability
 * standard (no raw hex; on-band/scrim tokens).
 */
export function CoverageChip({ coverage }: { coverage: CoverageChipData | null }) {
  if (!coverage) return null;
  const pct = Math.round(coverage.coverageShare * 100);
  const prominent = coverage.prominent;
  return (
    <HelpTooltip content={TOOLTIP}>
      <span
        data-testid="coverage-chip"
        data-prominent={prominent ? 'true' : 'false'}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums cursor-help',
          prominent
            ? 'bg-status-warningBg text-status-warningFg border border-status-warning'
            : 'text-ink-muted',
        )}
      >
        {prominent ? <ShieldAlert size={11} aria-hidden /> : <ShieldCheck size={11} aria-hidden />}
        <bdi dir="ltr">{pct}%</bdi>
        <span>כיסוי ייחוס</span>
      </span>
    </HelpTooltip>
  );
}

import { cn } from '@/lib/utils';
import { HelpTooltip } from '@/components/ui/Tooltip';

/**
 * Phase 4 — first-click coverage chip. Coverage = first-click-matched orders
 * ÷ last-click(deterministic)-matched orders. First-click coverage is a
 * DIRECTIONAL FLOOR (<= last-click) because store-side capture (cookie/cart
 * attribute) is lossier than the platform click-id. Quiet by default; warn
 * tone only when low. Google-blind caveat in the title. Token-driven, both
 * themes (on-band/scrim tokens — 2026-06-01 readability standard).
 */
export function FirstClickCoverageChip({
  firstClickOrders,
  lastClickOrders,
}: {
  firstClickOrders: number;
  lastClickOrders: number;
}) {
  const coverage = lastClickOrders > 0 ? firstClickOrders / lastClickOrders : 0;
  const pct = Math.round(coverage * 100);
  // Quiet unless meaningfully low (<50% of last-click captured first-touch).
  const tone: 'quiet' | 'warn' = coverage >= 0.5 ? 'quiet' : 'warn';
  const title =
    `כיסוי first-click: ${firstClickOrders} מתוך ${lastClickOrders} הזמנות מתויגות. ` +
    'תמיד <= last-click (לכידת cookie/cart לוסית יותר מ-click-id). ' +
    'first-click עיוור ל-Google (כמו last-click).';
  return (
    <HelpTooltip content={title}>
      <span
        data-testid="first-click-coverage-chip"
        data-tone={tone}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums cursor-help',
          tone === 'quiet'
            ? 'bg-glass-2 text-ink-secondary'
            : 'bg-status-warningBg text-status-warningFg',
        )}
      >
        <bdi dir="ltr">{pct}%</bdi>
        <span>first-click</span>
      </span>
    </HelpTooltip>
  );
}

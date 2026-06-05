'use client';

import { useId, useState } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { UnknownBucketPanel } from '@/components/home/UnknownBucketPanel';
import type { CoverageChip as CoverageChipData } from '@/lib/home/adapters';
import type { UnknownBucketBreakdown } from '@/lib/home/unknownBucket';

const TOOLTIP =
  'אחוז ההזמנות שנושאות סימן ייחוס (click-id / UTM). ה"לא ידוע" הנותר הוא לרוב ' +
  'תשלום מהיר (express checkout), חנות headless / draft, תנועה לא מתויגת, או ' +
  'פרמטרים שנחתכו ע״י פרטיות הדפדפן. ערוצים + לא-ידוע = 100% — לעולם לא מחולק מחדש.';

/** Shared chip body — the icon + "{pct}% כיסוי ייחוס" content, identical in
 *  every render path so the chip always reads the same honest summary. */
function ChipContent({ pct, prominent }: { pct: number; prominent: boolean }) {
  return (
    <>
      {prominent ? <ShieldAlert size={11} aria-hidden /> : <ShieldCheck size={11} aria-hidden />}
      <bdi dir="ltr">{pct}%</bdi>
      <span>כיסוי ייחוס</span>
    </>
  );
}

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums';
const CHIP_PROMINENT = 'bg-status-warningBg text-status-warningFg border border-status-warning';
const CHIP_QUIET = 'text-ink-muted';

/**
 * Honest attribution-coverage chip — HERO ONLY (never on per-store cards).
 * Quiet by default (muted ink, no border); visually prominent only when the
 * unknown share is bad (> 30%). Renders nothing when there are no orders.
 *
 * WS7 A.3 — when an `UnknownBucketBreakdown` is supplied AND the chip is
 * prominent, the chip becomes an inline DISCLOSURE: a button trigger (with a
 * caret) toggles an inline <UnknownBucketPanel> directly beneath it (accordion,
 * not a floating overlay — the panel is plain inline content driven by an
 * accessible aria-expanded button, so there is no inert-overlay-over-Radix
 * hazard). The chip's default appearance is UNCHANGED when no breakdown is
 * passed OR the chip is not prominent, so it stays backward-compatible and
 * remains the honest summary in the common case.
 *
 * Numbers go through token-driven styling per the 2026-06-01 readability
 * standard (no raw hex; on-band/scrim tokens).
 */
export function CoverageChip({
  coverage,
  breakdown,
}: {
  coverage: CoverageChipData | null;
  breakdown?: UnknownBucketBreakdown;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  if (!coverage) return null;
  const pct = Math.round(coverage.coverageShare * 100);
  const prominent = coverage.prominent;

  // Disclosure whenever there is something to disclose — the operator wants to
  // inspect the unknown bucket even when coverage is healthy (the >30% prominent
  // gate hid the feature entirely at normal coverage). The chip's COLOR still
  // tracks `prominent` (quiet when healthy, warning band when bad); only the
  // expandability is unconditional. The panel renders null when unknownOrders
  // === 0, so a zero-unknown chip stays the static summary.
  const canExpand = !!breakdown && breakdown.unknownOrders > 0;

  if (!canExpand) {
    // Backward-compatible path — unchanged static chip + tooltip.
    return (
      <HelpTooltip content={TOOLTIP}>
        <span
          data-testid="coverage-chip"
          data-prominent={prominent ? 'true' : 'false'}
          className={cn(CHIP_BASE, 'cursor-help', prominent ? CHIP_PROMINENT : CHIP_QUIET)}
        >
          <ChipContent pct={pct} prominent={prominent} />
        </span>
      </HelpTooltip>
    );
  }

  // Disclosure path — the chip is a button that toggles an inline panel below.
  return (
    <div className="flex flex-col items-end gap-2">
      <HelpTooltip content={TOOLTIP}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          data-testid="coverage-chip"
          data-prominent={prominent ? 'true' : 'false'}
          aria-expanded={open}
          // Only reference the panel while it's mounted (it renders only when
          // open) so aria-controls never dangles on the collapsed accordion.
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
          // twMerge lets these win over the ghost/sm defaults: collapse the
          // h-8/px-3/text-xs sizing back down to the micro-chip, then layer on
          // the band tokens. COLOR tracks `prominent` (warning band when the
          // unknown share is bad, quiet muted ink when coverage is healthy) so
          // an always-expandable healthy chip never looks alarming.
          className={cn(
            'h-auto',
            CHIP_BASE,
            prominent ? CHIP_PROMINENT : CHIP_QUIET,
            'cursor-pointer hover:brightness-110',
          )}
        >
          <ChipContent pct={pct} prominent={prominent} />
          <ChevronDown
            size={11}
            aria-hidden
            className={cn('transition-transform', open && 'rotate-180')}
          />
          {/* Disclosure-trigger hook for tests / tooling. The Button itself
              carries data-testid="coverage-chip" so the existing assertions
              still resolve to the same element; this child gives the expand
              affordance its own stable handle and an a11y label. */}
          <span data-testid="coverage-chip-expand" className="sr-only">
            {open ? 'סגור פירוק' : 'הצג פירוק'}
          </span>
        </Button>
      </HelpTooltip>
      {open && breakdown && (
        <div id={panelId} className="w-full">
          <UnknownBucketPanel breakdown={breakdown} />
        </div>
      )}
    </div>
  );
}

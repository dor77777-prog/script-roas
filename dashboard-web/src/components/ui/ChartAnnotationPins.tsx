'use client';

/**
 * <ChartAnnotationPins> — shared annotation-pin overlay primitive.
 *
 * SINGLE SOURCE OF TRUTH for the operator-logged event pins that ride on
 * top of a ROAS line chart (the amber 💰/✨ glyphs + their hover/click
 * tooltips). Extracted from <RoasTargetChart>'s inline overlay (the proven,
 * operator-reviewed hero chart) so the Trends-tab <RoasChart> can mount the
 * EXACT same pin behaviour without re-implementing it.
 *
 * Geometry contract — chart-agnostic by design:
 *   The overlay is an absolutely-positioned `inset-0` layer the consumer
 *   stacks over its plot. Each pin's horizontal position is resolved by the
 *   consumer-supplied `leftPctForIndex(index)` (0–100), where `index` is the
 *   pin's slot in the `dates` array. This keeps the primitive ignorant of
 *   HOW the underlying chart draws (hand-rolled SVG viewBox math in the hero
 *   chart vs. Recharts plot insets in the Trends chart) — it only needs the
 *   final left-percentage.
 *
 *   The wrapper is forced `dir="ltr"` so `left:%` is measured from the
 *   visual-left edge regardless of the page's RTL text direction (mirrors
 *   the hero chart's overlay note). Tooltips inside flip back to `dir="rtl"`
 *   for Hebrew-first copy.
 *
 * Interaction model (matches [[home-visual-rules]]):
 *   • Pin tooltips are HOVER-AND-CLICK ONLY — never always-visible.
 *   • A single `openPinId` — hover sets it, click toggles, a pointerdown
 *     OUTSIDE this overlay clears it (touch-friendly: no pointerleave on a
 *     phone). The listener is scoped to this overlay's own ref, so a tap on
 *     the bare plot (sibling SVG) closes the pin while leaving the
 *     consumer's own crosshair logic free to react to the same tap.
 *
 * Accessibility / tokens:
 *   • Pin glyph is a real <Button> (no raw <button>); tooltip is role="tooltip".
 *   • Amber milestone accent via `border-status-warning`; surface via the
 *     shared glass rich-card tokens. No raw hex.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn, formatDate } from '@/lib/utils';

export interface ChartAnnotationPin {
  id: string;
  /** ISO YYYY-MM-DD — must match one of the `dates` entries to render. */
  date: string;
  /** Emoji glyph; defaults to 💰 (matches the hero chart). */
  icon?: string;
  /** Tooltip text — Hebrew-first. */
  label: string;
}

export interface ChartAnnotationPinsProps {
  /** Operator-logged events, already scope-filtered by the caller. */
  pins: ChartAnnotationPin[];
  /**
   * Ordered x-axis dates (one per plotted day). A pin only renders when its
   * `date` is present here — out-of-range pins are silently dropped, mirroring
   * the hero chart's `renderablePins` memo.
   */
  dates: string[];
  /** index in `dates` → overlay `left:` percentage (0–100). */
  leftPctForIndex: (index: number) => number;
  /**
   * Optional ROAS/value at a given date, surfaced as a context line in the
   * pin tooltip ("· ROAS 2.84"). Return null when the day has no value.
   */
  valueForDate?: (date: string) => number | null;
  /** Tooltip context-value label. Defaults to "ROAS". */
  valueLabel?: string;
  /**
   * When true, draw a thin dashed vertical guide line under each pin (a CSS
   * div, full overlay height). The hero chart keeps its guides inside the
   * SVG and leaves this OFF; the Recharts Trends chart turns it ON so the
   * pin still visually anchors to its day.
   */
  showGuides?: boolean;
  className?: string;
}

export function ChartAnnotationPins({
  pins,
  dates,
  leftPctForIndex,
  valueForDate,
  valueLabel = 'ROAS',
  showGuides = false,
  className,
}: ChartAnnotationPinsProps) {
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Dismiss-on-tap-outside (touch-friendly). A tap anywhere outside THIS
  // overlay closes the open tooltip. pointerdown fires before click, so a
  // tap on another pin still toggles the right one (handled in onClick).
  useEffect(() => {
    if (openPinId === null) return;
    const handler = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      const wrap = wrapRef.current;
      if (!target || !wrap) return;
      if (!wrap.contains(target)) setOpenPinId(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [openPinId]);

  // date → index, then drop pins whose date isn't on the axis.
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const renderable = pins
    .map((pin) => {
      const index = dateIndex.get(pin.date);
      if (index === undefined) return null;
      return { pin, index, leftPct: leftPctForIndex(index) };
    })
    .filter((p): p is { pin: ChartAnnotationPin; index: number; leftPct: number } => p !== null);

  if (renderable.length === 0) return null;

  return (
    // RTL note: explicit dir="ltr" so the left-% anchors from the visual-left
    // edge regardless of the page's RTL direction (without it RTL flips the %).
    <div
      ref={wrapRef}
      className={cn('absolute inset-0 pointer-events-none', className)}
      dir="ltr"
      data-testid="chart-annotation-pins"
    >
      {renderable.map(({ pin, leftPct }) => {
        const isOpen = openPinId === pin.id;
        const ctxValue = valueForDate ? valueForDate(pin.date) : null;
        return (
          <div
            key={pin.id}
            className="absolute"
            style={{ left: `${leftPct}%`, top: 0, height: '100%' }}
          >
            {showGuides && (
              <span
                aria-hidden
                className="absolute top-0 bottom-0 w-0 border-s border-dashed"
                style={{
                  transform: 'translateX(-50%)',
                  borderInlineStartColor: 'var(--chart-pin-line)',
                  opacity: 0.5,
                }}
                data-testid={`chart-pin-guide-${pin.id}`}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`chart-pin-${pin.id}`}
              aria-label={pin.label}
              aria-expanded={isOpen}
              onMouseEnter={() => setOpenPinId(pin.id)}
              onMouseLeave={() =>
                setOpenPinId((prev) => (prev === pin.id ? null : prev))
              }
              onClick={(e) => {
                e.stopPropagation();
                setOpenPinId((prev) => (prev === pin.id ? null : pin.id));
              }}
              className={cn(
                'pointer-events-auto absolute p-0 h-auto bg-transparent hover:bg-transparent',
                'text-lg leading-none cursor-pointer rounded-sm',
              )}
              style={{
                transform: 'translateX(-50%)',
                top: -6,
                textShadow: '0 0 8px oklch(from var(--chart-pin-line) l c h / 0.7)',
              }}
            >
              {pin.icon ?? '💰'}
            </Button>
            {isOpen && (
              <div
                role="tooltip"
                data-testid={`chart-pin-tooltip-${pin.id}`}
                className={cn(
                  // Shared rich-card chrome (surface/blur/radius/shadow) +
                  // amber milestone accent border (ties the bubble to the pin
                  // glyph). Matches the hero chart's pin tooltip exactly.
                  'absolute z-10 w-max max-w-[14rem] text-ink px-3 py-2 rounded-card',
                  'bg-glass-1/95 backdrop-blur-sm border border-status-warning shadow-overlay',
                  'animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out',
                )}
                style={{ transform: 'translateX(-50%)', top: -64 }}
                dir="rtl"
              >
                <div className="flex items-center gap-1.5 text-[12px] font-bold leading-snug">
                  <span aria-hidden>{pin.icon ?? '💰'}</span>
                  {pin.label}
                </div>
                <div className="mt-0.5 font-mono text-[10px] tabular-nums text-ink-muted">
                  {formatDate(pin.date)}
                  {ctxValue != null && (
                    <> · {valueLabel} {ctxValue.toFixed(2)}</>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

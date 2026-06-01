'use client';

/**
 * Feature B3 (2026-06-01) — MOBILE-ONLY collapsing sticky ROAS summary.
 *
 * A `md:hidden` bar pinned to the top of the Home scroll area that surfaces the
 * ROAS-vs-target headline: a big ROAS number (tabular `<bdi dir="ltr">`), a
 * 'יעד 3.0' caption, and a delta chip versus the previous period (green ▲ up /
 * red ▼ down). On scroll it COLLAPSES — the ROAS number shrinks and the target
 * caption hides via a max-height / opacity transition — mirroring the mockup's
 * `.scr.collapsed .sticky` rules
 * (docs/superpowers/mockups/2026-06-01-mobile/mobile-home-v2.html).
 *
 * Collapse mechanism: a 1px SENTINEL rendered just ABOVE the sticky bar. An
 * IntersectionObserver watching the sentinel toggles `collapsed` when it
 * scrolls out of view at the top (preferred over a scroll listener — cheaper,
 * no layout thrash). Reduced motion (useReducedMotion) gates the size/opacity
 * TRANSITION classes: when reduce is on, the collapsed state still applies but
 * with no animated transition (matches the project motion contract).
 *
 * z-index: the app's sticky top header sits at z-30 (Dashboard.tsx). This bar
 * pins WITHIN the Home content at z-20 so it never overlaps that header.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, formatNumber } from '@/lib/utils';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

export interface MobileStickyRoasProps {
  /** Business-wide ROAS for the active range; null → render "—" (no chip math). */
  roas: number | null;
  /** Target ROAS line — defaults to 3.0. */
  target?: number;
  /** % change vs the previous period; null → no delta chip rendered. */
  deltaPct: number | null;
  /** Optional range label (e.g. "30 ימים אחרונים") shown in the caption row. */
  rangeLabel?: string;
}

export function MobileStickyRoas({
  roas,
  target = 3.0,
  deltaPct,
  rangeLabel,
}: MobileStickyRoasProps) {
  const reduced = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver on the 1px sentinel ABOVE the bar. When the sentinel
  // leaves the top of the scroll area (isIntersecting=false) the bar collapses.
  // SSR / no-IO environments leave the bar in its expanded rest state.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setCollapsed(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const roasText = roas == null || Number.isNaN(roas) ? '—' : `${formatNumber(roas, 2)}`;

  // Delta chip: only when deltaPct is a finite number. Up = ≥0 (green ▲),
  // down = <0 (red ▼). The tone is a guaranteed-contrast on-surface ink token
  // (--up / --dn), never derived from a band hue.
  const delta = useMemo(() => {
    if (deltaPct == null || Number.isNaN(deltaPct)) return null;
    const up = deltaPct >= 0;
    return {
      up,
      text: `${up ? '▲ +' : '▼ '}${formatNumber(Math.abs(deltaPct), 1)}%`,
    };
  }, [deltaPct]);

  // Transition classes are applied ONLY when motion is allowed. Under reduced
  // motion the collapsed state still changes the sizes, but with no animation.
  const motionTransition = reduced ? '' : 'transition-all duration-DEFAULT ease-out';

  return (
    <>
      {/* 1px sentinel — sits just above the sticky bar. When it scrolls out of
          view at the top of the scroll area, the bar collapses. */}
      <div ref={sentinelRef} aria-hidden="true" className="md:hidden h-px w-full" />

      <div
        data-testid="mobile-sticky-roas"
        data-collapsed={collapsed}
        dir="rtl"
        className={cn(
          // MOBILE-ONLY. Pinned at z-20 — BELOW the app header (z-30) so it
          // never overlaps it; offset `top` by the slim header's height
          // (sticky top-0 z-30, py-2 ≈ 3.25rem) so the bar pins JUST under the
          // header instead of behind it. Frosted canvas wash + bottom hairline.
          // The wash uses color-mix(... var(--canvas) ...) (mockup `.sticky`
          // background) instead of a slash-alpha on the flat --canvas token,
          // which silently drops its alpha (designColorGuard rule 5).
          'md:hidden sticky top-[3.25rem] z-20',
          'bg-[color-mix(in_oklab,var(--canvas)_86%,transparent)] backdrop-blur-xl border-b border-glass-edge',
          'px-4 py-3',
          collapsed && 'py-2',
          motionTransition,
        )}
      >
        <div className="flex items-baseline justify-between gap-2.5">
          <div className="flex items-baseline gap-2">
            <bdi
              dir="ltr"
              data-testid="mobile-sticky-roas-value"
              className={cn(
                'font-extrabold tabular-nums leading-none text-ink',
                collapsed ? 'text-xl' : 'text-3xl',
                motionTransition,
              )}
            >
              {roasText}
            </bdi>
            {delta && (
              <span
                data-testid="mobile-sticky-roas-delta"
                className={cn(
                  'inline-flex items-center text-xs font-extrabold tabular-nums',
                  'px-2 py-0.5 rounded-pill',
                  delta.up
                    ? 'text-status-greenFg bg-status-greenBg'
                    : 'text-status-redFg bg-status-redBg',
                )}
              >
                <bdi dir="ltr">{delta.text}</bdi>
              </span>
            )}
          </div>
          <span className="text-xs text-ink-muted text-start">ROAS · מול יעד</span>
        </div>

        {/* Target / range caption — hides (opacity + max-height) when collapsed,
            mirroring the mockup `.sticky .tgt`. */}
        <div
          data-testid="mobile-sticky-roas-target"
          className={cn(
            'text-[11px] text-ink-muted overflow-hidden',
            collapsed ? 'opacity-0 max-h-0 mt-0' : 'opacity-100 max-h-5 mt-1',
            motionTransition,
          )}
        >
          יעד <bdi dir="ltr" className="tabular-nums">{formatNumber(target, 1)}</bdi>
          {rangeLabel ? ` · ${rangeLabel}` : ''}
        </div>
      </div>
    </>
  );
}

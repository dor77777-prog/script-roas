'use client';

import { useState } from 'react';
import { Info, Package, X } from 'lucide-react';
import type { ProductChannelBreakdown as ProductChannelBreakdownType } from '@/lib/attributionAnalysis';
import { PRODUCT_MAP_CHIP_KEY } from '@/lib/sessionKeys';
import { CHART_COLORS } from '@/lib/chartColors';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { Heading } from '@/components/ui/Typography';

/**
 * Phase 1 channel-level product attribution panel — answers "where did the
 * sales of this campaign's mapped products actually come from?". Visible
 * when the parent's triple-gate (platform Meta / mapped products / ≥3
 * orders) passes; the gate itself lives in CampaignDrawer's
 * `productChannelBreakdown` useMemo and is NOT duplicated here.
 *
 * Hebrew literals (D-05), the `&quot;` HTML entity, and the emoji
 * recommendation chips (💡 green ≥60%, ⚠️ amber <30% + ≥5 orders) are
 * lifted byte-identical from CampaignDrawer.tsx pre-refactor (lines
 * 699-760 JSX block).
 */
type Props = {
  breakdown: ProductChannelBreakdownType;
};

export function ProductChannelBreakdown({ breakdown }: Props) {
  const [chipHidden, setChipHidden] = useState(() => (
    typeof window !== 'undefined' && window.sessionStorage.getItem(PRODUCT_MAP_CHIP_KEY) === '1'
  ));
  const total = breakdown.totalOrders;
  // d/CR-05 (audit 2026-05-23): bail when total === 0. Without this guard,
  // every `(fb / total) * 100` etc. below resolves to NaN%, which renders
  // the segment bar as broken (browsers drop NaN widths to 0, but the bar
  // looks empty/cosmetically broken — and the share-based recommendation
  // chips below are meaningless on zero-order data anyway). The parent's
  // triple-gate (CampaignDrawer's `productChannelBreakdown` useMemo) is
  // supposed to suppress this path entirely, but the gate is platform/
  // mapping-aware not zero-order-aware, so empty breakdowns can still slip
  // through (e.g., when the parent's order count >= 3 but the breakdown
  // returns 0 after its own filtering). Returning null here is the safe
  // floor — the parent's surface still renders cleanly without us.
  if (total <= 0) return null;
  // Audit fix 2026-05-23 (CRIT-2 / O2-CR-01): exclusive source attribution.
  //
  // Pre-fix, `fb` used `breakdown.facebookOrders` (broad OR predicate:
  // source in {meta-paid, meta-organic} OR fbclidPresent=true). A
  // google-paid order with a stale fbclid cookie was double-counted in
  // both `fb` and `google`, so segments summed to >100% and the
  // residual `other` (email / affiliate / unknown surfaces) was clamped
  // to 0 — silently dropping legitimate revenue from the bar.
  //
  // Now every segment is derived from `bySource` only (mutually-exclusive
  // buckets). `other` becomes everything not explicitly placed in one of
  // the four named buckets, including email/affiliate/other-paid/
  // other-referral plus any residual unknown source.
  const fb = (breakdown.bySource['meta-paid']?.orders ?? 0)
           + (breakdown.bySource['meta-organic']?.orders ?? 0);
  const google = (breakdown.bySource['google-paid']?.orders ?? 0)
              + (breakdown.bySource['google-organic']?.orders ?? 0);
  // Phase 05.7.9 — TikTok bucket. tiktok-paid is currently the only TikTok
  // source classification (organic TikTok referrers fall through to
  // 'other-referral' per shopify.ts:classifyOrderAttribution line 900-906).
  // Read from bySource so the math stays exclusive with all other segments.
  const tiktok = breakdown.bySource['tiktok-paid']?.orders ?? 0;
  const direct = breakdown.bySource['direct']?.orders ?? 0;
  const knownExplicit = fb + google + tiktok + direct;
  // `other` now naturally sums-to-total because the explicit buckets are
  // exclusive. The `Math.max(0, ...)` guard stays as defense-in-depth
  // against future bugs where a bucket count could exceed `total`.
  const other = Math.max(0, total - knownExplicit);
  // Audit fix 2026-05-23 (CRIT-2, Codex caveat): chip recommendations also
  // derive their Facebook share from the exclusive Meta count — NOT from
  // `breakdown.facebookShare` (which is OR-inflated by fbclid-tagged
  // non-Meta orders). Otherwise a campaign with 40% real Meta + 20% Google
  // (where some Google orders have fbclid) would trip the "≥60% Facebook"
  // green chip on a falsely-inflated signal.
  const exclusiveFacebookShare = fb / total;
  const fbPct = Math.round(exclusiveFacebookShare * 100);
  return (
    <section>
      <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
        <Package size={14} className="text-ink-secondary" />
        <HelpTooltip content="סיגנל זה משלים את ה-trust chip. הוא מודד 'מאיפה הגיעו הקונים של המוצרים המשויכים' גם כש-utm_id חסר.">
          <span>מכירות לפי ערוץ של המוצרים המשויכים</span>
        </HelpTooltip>
      </Heading>
      <div className="rounded-xl border border-glass-edge bg-glass-2/30 p-3 space-y-3">
        {!chipHidden && (
          <HelpTooltip content="current state, not date-versioned">
            <div className="rounded-md bg-glass-2 border border-glass-edge px-2.5 py-1.5 text-[11px] text-ink-muted flex items-center gap-1.5">
              <Info size={12} className="shrink-0 text-ink-subtle" />
              <span className="leading-relaxed">
                ה-product↔campaign mapping מבוסס על המיפוי הנוכחי שלך. שינוי המיפוי משפיע על נתונים היסטוריים בדיעבד.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="הסתר הודעת מיפוי"
                onClick={() => {
                  window.sessionStorage.setItem(PRODUCT_MAP_CHIP_KEY, '1');
                  setChipHidden(true);
                }}
                className="ms-auto shrink-0"
              >
                <X size={12} />
              </Button>
            </div>
          </HelpTooltip>
        )}

        {/* Summary line — total orders + CAD */}
        <div className="text-[12px] text-ink-secondary tabular-nums">
          {total} הזמנות של מוצרים משויכים · CAD {breakdown.totalRevenue.toFixed(0)} סה&quot;כ
        </div>

        {/* 5-segment source breakdown bar (Phase 05.7.9 — added TikTok). */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-ink-secondary tabular-nums">
            <span>
              פייסבוק: {fb} · גוגל: {google} · טיקטוק: {tiktok} · ישיר: {direct} · אחר: {other}
            </span>
          </div>
          {/* 5-segment source bar — paid platform segments (Facebook=Meta,
              Google, TikTok) read CHART_COLORS for brand-true colors that
              match the per-platform lines elsewhere in the dashboard.
              Direct + Other stay neutral grays (they aren't paid identities). */}
          <div className="h-2.5 rounded-full bg-glass-2 overflow-hidden flex">
            <div className="h-full" style={{ width: `${(fb / total) * 100}%`,     background: CHART_COLORS.meta }} />
            <div className="h-full" style={{ width: `${(google / total) * 100}%`, background: CHART_COLORS.google }} />
            <div className="h-full" style={{ width: `${(tiktok / total) * 100}%`, background: CHART_COLORS.tiktok }} />
            <div className="h-full bg-ink-muted"  style={{ width: `${(direct / total) * 100}%` }} />
            <div className="h-full bg-ink-subtle" style={{ width: `${(other / total) * 100}%` }} />
          </div>
        </div>

        {/* Recommendation chips — two variants per PATTERNS.md §5c.
            Green: ≥60% Facebook → confidence to scale.
            Amber: <30% Facebook AND ≥5 orders → caution (the
            ≥5-orders floor is plan-level; a brand-new campaign
            with 0% on only 3 orders is noise, not signal —
            RESEARCH.md Open Question 2).
            Between 30% and 60%: no chip per CONTEXT.

            Audit fix 2026-05-23 (CRIT-2 Codex caveat): both thresholds
            now read `exclusiveFacebookShare` (Meta-only count / total)
            instead of `breakdown.facebookShare` (which is OR-inflated
            by fbclid-tagged orders whose true source is Google/email/
            other). Without this, a 40%-real-Meta + 20%-Google campaign
            with stale fbclid cookies on the Google traffic could trip
            the green ≥60% chip on a phantom signal — recommending
            budget increase off attribution noise. */}
        {exclusiveFacebookShare >= 0.6 && (
          <div className="rounded-md bg-status-greenBg/50 border border-status-green/30 text-status-green px-2.5 py-2 text-[11px] leading-relaxed">
            <strong>💡 </strong>
            {fbPct}% מהמכירות הגיעו מפייסבוק
            {' → '}
            ביטחון להעלאת תקציב הקמפיין
          </div>
        )}
        {exclusiveFacebookShare < 0.3 && total >= 5 && (
          <div className="rounded-md bg-status-warningBg border border-status-warning/30 text-status-warningFg px-2.5 py-2 text-[11px] leading-relaxed">
            <strong>⚠️ </strong>
            רק {fbPct}% מהמכירות הגיעו מפייסבוק
            {' → '}
            ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב
          </div>
        )}
      </div>
    </section>
  );
}

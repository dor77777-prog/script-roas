'use client';

import { useState } from 'react';
import { Info, Package, X } from 'lucide-react';
import type { ProductChannelBreakdown as ProductChannelBreakdownType } from '@/lib/attributionAnalysis';
import { PRODUCT_MAP_CHIP_KEY } from '@/lib/sessionKeys';

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
  const fb = breakdown.facebookOrders;
  const google = (breakdown.bySource['google-paid']?.orders ?? 0)
              + (breakdown.bySource['google-organic']?.orders ?? 0);
  const direct = breakdown.bySource['direct']?.orders ?? 0;
  const other = Math.max(0, total - fb - google - direct);
  const fbPct = Math.round(breakdown.facebookShare * 100);
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
        <Package size={14} className="text-text-secondary" />
        <span title="סיגנל זה משלים את ה-trust chip. הוא מודד 'מאיפה הגיעו הקונים של המוצרים המשויכים' גם כש-utm_id חסר.">
          מכירות לפי ערוץ של המוצרים המשויכים
        </span>
      </h3>
      <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
        {!chipHidden && (
          <div
            title="current state, not date-versioned"
            className="rounded-md bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[11px] text-text-muted flex items-center gap-1.5"
          >
            <Info size={12} className="shrink-0 text-text-subtle" />
            <span className="leading-relaxed">
              ה-product↔campaign mapping מבוסס על המיפוי הנוכחי שלך. שינוי המיפוי משפיע על נתונים היסטוריים בדיעבד.
            </span>
            <button
              type="button"
              aria-label="הסתר הודעת מיפוי"
              onClick={() => {
                window.sessionStorage.setItem(PRODUCT_MAP_CHIP_KEY, '1');
                setChipHidden(true);
              }}
              className="ms-auto shrink-0 rounded p-0.5 text-text-subtle hover:bg-gray-100 hover:text-text-secondary transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Summary line — total orders + CAD */}
        <div className="text-[12px] text-text-secondary tabular-nums">
          {total} הזמנות של מוצרים משויכים · CAD {breakdown.totalRevenue.toFixed(0)} סה&quot;כ
        </div>

        {/* 4-segment source breakdown bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-text-secondary tabular-nums">
            <span>פייסבוק: {fb} · גוגל: {google} · ישיר: {direct} · אחר: {other}</span>
          </div>
          <div className="h-2.5 rounded-full bg-surfaceMuted overflow-hidden flex">
            <div className="h-full bg-roas-blue"   style={{ width: `${(fb / total) * 100}%` }} />
            <div className="h-full bg-amber-500"   style={{ width: `${(google / total) * 100}%` }} />
            <div className="h-full bg-text-muted"  style={{ width: `${(direct / total) * 100}%` }} />
            <div className="h-full bg-text-subtle" style={{ width: `${(other / total) * 100}%` }} />
          </div>
        </div>

        {/* Recommendation chips — two variants per PATTERNS.md §5c.
            Green: ≥60% Facebook → confidence to scale.
            Amber: <30% Facebook AND ≥5 orders → caution (the
            ≥5-orders floor is plan-level; a brand-new campaign
            with 0% on only 3 orders is noise, not signal —
            RESEARCH.md Open Question 2).
            Between 30% and 60%: no chip per CONTEXT. */}
        {breakdown.facebookShare >= 0.6 && (
          <div className="rounded-md bg-roas-greenBg/50 border border-roas-green/30 text-roas-green px-2.5 py-2 text-[11px] leading-relaxed">
            <strong>💡 </strong>
            {fbPct}% מהמכירות הגיעו מפייסבוק
            {' → '}
            ביטחון להעלאת תקציב הקמפיין
          </div>
        )}
        {breakdown.facebookShare < 0.3 && total >= 5 && (
          <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-2.5 py-2 text-[11px] leading-relaxed">
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

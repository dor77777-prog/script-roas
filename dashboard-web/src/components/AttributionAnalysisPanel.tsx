'use client';

import { TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtMoney } from '@/lib/format';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';
import { Heading } from '@/components/ui/Typography';

/**
 * Trust verdict callout shown inside the campaign drawer. The parent
 * (CampaignDrawer.tsx) is responsible for calling `analyzeAttribution(...)`
 * and gating with `{analysis && <AttributionAnalysisPanel ... />}`; this
 * component renders the visual callout unconditionally given a non-null
 * `analysis` (Shape B from PATTERNS.md).
 *
 * Hebrew literals (D-05) and the 4-level trust-bg ladder are lifted
 * verbatim from CampaignDrawer.tsx pre-refactor (lines 690-803).
 */
type Props = {
  analysis: AttributionAnalysis;
  spend: number;
  value: number;
};

export function AttributionAnalysisPanel({ analysis, spend, value }: Props) {
  const trustBg =
    analysis.trust.level === 'high'    ? 'bg-status-greenBg/50 border-status-green/30 text-status-green'
  : analysis.trust.level === 'medium'  ? 'bg-status-warningBg border-status-warning/30 text-status-warningFg'
  : analysis.trust.level === 'unknown' ? 'bg-glass-2 border-glass-edge text-ink-secondary'
  :                                      'bg-status-redBg/50 border-status-red/30 text-status-red';

  const detRoas = spend > 0
    ? analysis.deterministicRevenue / spend
    : 0;
  const metaRoas = spend > 0
    ? value / spend
    : 0;

  return (
    <section>
      <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-ink-secondary" />
        ניתוח attribution
      </Heading>
      <div className={cn('rounded-xl border p-3 space-y-3', trustBg)}>
        {/* AUDIT U-05 (2026-05-24): pixel-broken warning chip. When
            deterministicRevenue exceeds 2× of Meta's claim, the pixel is
            almost certainly missing conversions wholesale (iOS 14 silent
            failure, ad-blocker storm, attribution-window drift). Pre-fix,
            the coverage field was hard-clamped to 2.0 and the operator
            never knew. Now we show the raw value AND surface a banner so
            it's impossible to miss. */}
        {analysis.coverageExceedsClamp && (
          <div
            role="alert"
            className="rounded-md bg-status-redBg border border-status-red/40 text-status-red px-3 py-2 flex items-start gap-2 text-[11px] leading-relaxed"
          >
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            <div>
              <strong className="block font-semibold">⚠ הילה חריגה ({(analysis.coverage * 100).toFixed(0)}%) — בדוק את הפיקסל</strong>
              <span className="opacity-80">
                Shopify רואה יותר מפי-2 הזמנות ממה ש-Meta דיווחה — סימן לפיקסל
                שבור / חסום, לדריפט של חלון הייחוס, או לקמפיינים אחרים שמושכים
                הזמנות לתוך המיפוי.
              </span>
            </div>
          </div>
        )}
        {/* Header: trust verdict + score */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="shrink-0">
            <div className="text-[11px] sm:text-[10px] uppercase tracking-wide opacity-70">
              ציון אמינות
            </div>
            <div className="text-2xl font-bold tabular-nums leading-tight">
              {analysis.trust.score.toFixed(0)}<span className="text-sm opacity-60">/100</span>
            </div>
            <div className="text-[11px] font-semibold">{analysis.trust.label}</div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] sm:text-[10px] uppercase opacity-60">ROAS אמיתי (click-id)</div>
                <div className="text-base font-semibold tabular-nums">
                  {detRoas > 0 ? `${detRoas.toFixed(2)}x` : '—'}
                </div>
                {analysis.roasInterval && (
                  <div className="text-[10px] opacity-60 tabular-nums">
                    טווח 95%: {analysis.roasInterval.low.toFixed(2)} – {analysis.roasInterval.high.toFixed(2)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] sm:text-[10px] uppercase opacity-60">ROAS לפי Meta</div>
                <div className="text-base font-semibold tabular-nums">
                  {metaRoas > 0 ? `${metaRoas.toFixed(2)}x` : '—'}
                </div>
                <div className="text-[10px] opacity-60 tabular-nums">
                  {fmtMoney(value)} מדווח
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Breakdown bar: deterministic vs modeled */}
        {value > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="opacity-80">click-id מתויג: {analysis.deterministicOrders} הזמנות ({fmtMoney(analysis.deterministicRevenue)})</span>
              <span className="opacity-80">modeled: {fmtMoney(analysis.modeledRevenue)}</span>
            </div>
            {/* FIX-12 (5.2.2.1): clamp widths to [0, 100]; signed revenue can otherwise produce negative widths or >100% bars. */}
            <div className="h-2.5 rounded-full bg-white/40 overflow-hidden flex">
              <div
                className="h-full bg-current opacity-70"
                style={{ width: `${Math.max(0, Math.min(100, (analysis.deterministicRevenue / value) * 100))}%` }}
              />
              <div
                className="h-full bg-current opacity-25"
                style={{ width: `${Math.max(0, Math.min(100, (analysis.modeledRevenue / value) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Reasons list */}
        {analysis.reasons.length > 0 && (
          <ul className="text-[11px] space-y-1 leading-relaxed">
            {analysis.reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="opacity-60">•</span>
                <span className="opacity-90">{r}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Recommendation callout */}
        {analysis.recommendation && (
          <div className="rounded-md bg-white/40 border border-current/20 px-2.5 py-2 text-[11px] leading-relaxed">
            <strong>💡 המלצה:</strong> {analysis.recommendation}
          </div>
        )}

        {/* Window stability + outliers footer */}
        {(analysis.windowStability || analysis.outlierDays.length > 0) && (
          <div className="text-[10px] flex flex-wrap gap-2 pt-1 border-t border-current/15">
            {analysis.windowStability && (
              <span className="opacity-70">
                יציבות ({analysis.windowStability.windowCountWithData} שבועות):{' '}
                <strong>{analysis.windowStability.verdict === 'stable' ? 'יציב' : analysis.windowStability.verdict === 'mixed' ? 'מעורב' : 'תנודתי'}</strong>{' '}
                (σ={(analysis.windowStability.stdDev * 100).toFixed(0)}%)
              </span>
            )}
            {analysis.outlierDays.length > 0 && (
              <span className="opacity-70">
                • <strong>{analysis.outlierDays.length}</strong> ימי spike מ-Meta (modeled)
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

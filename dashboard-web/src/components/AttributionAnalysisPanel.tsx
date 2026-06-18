'use client';

import { TrendingUp, AlertTriangle, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Money } from '@/components/ui/Money';
import { SMALL_SAMPLE_ORDERS, type AttributionAnalysis } from '@/lib/attributionAnalysis';
import { Heading } from '@/components/ui/Typography';
import { InsightActions } from '@/components/insights/InsightActions';
import { useStoreAdAccounts } from '@/lib/hooks/useStoreAdAccounts';

/**
 * Trust verdict callout shown inside the campaign drawer. The parent
 * (CampaignDrawer.tsx) is responsible for calling `analyzeAttribution(...)`
 * and gating with `{analysis && <AttributionAnalysisPanel ... />}`; this
 * component renders the visual callout unconditionally given a non-null
 * `analysis` (Shape B from PATTERNS.md).
 *
 * Hebrew literals (D-05) are lifted verbatim from CampaignDrawer.tsx
 * pre-refactor (lines 690-803).
 *
 * Horizon re-skin (W4.5) — AA HARDENING: the pre-skin shell derived ALL of its
 * text/graphical contrast from `currentColor` (the container set `text-status-*Fg`
 * by band, then children dimmed it with `opacity-60/70/80/90` and drew bars/
 * borders with `bg-current` / `border-current`). That is text-contrast DERIVED
 * from a variable band hue at a variable opacity — a direct violation of the
 * project's non-negotiable AA mandate. The shell is now a NEUTRAL Card: every
 * text element uses an explicit neutral ink token (text-ink / text-ink-secondary
 * / text-ink-muted, all AA-locked by contrastGuard against the card surface), the
 * trust LEVEL is carried by a guaranteed-contrast `band-chip` + a thin top accent
 * bar (graphical, not text), and the breakdown bar fills paint neutral
 * pill-track tones. NO `bg-current` / `border-current` / opacity-derived text
 * contrast remains.
 */
type Props = {
  analysis: AttributionAnalysis;
  spend: number;
  value: number;
  // Task 5.6 (P1-10 / Q7) — optional campaign context for the Ads
  // Manager deep-link footer. Same shape and rationale as
  // `HealthScorePanel` (see its prop block). The primary "open drawer"
  // is hidden because this panel only renders inside the drawer.
  campaignId?: string;
  campaignName?: string;
  platform?: 'Meta' | 'Google' | 'TikTok';
  storeId?: string;
};

/**
 * Trust level → presentation. `chip` is the shared AA-safe band-chip recipe
 * (globals.css), `accent` is the thin top accent bar color (graphical only, not
 * text), and `bar` is the deterministic-revenue segment fill (a band hue at low
 * alpha on the neutral track — graphical, never text). Classification is
 * UNCHANGED (still `analysis.trust.level`); this only maps the level onto the
 * neutral Horizon recipe.
 */
const TRUST_CHIP: Record<AttributionAnalysis['trust']['level'], string> = {
  high: 'chip-green',
  medium: 'chip-orange',
  low: 'chip-red',
  unknown: 'chip-gray',
};
const TRUST_ACCENT: Record<AttributionAnalysis['trust']['level'], string> = {
  high: 'bg-status-green',
  medium: 'bg-status-warning',
  low: 'bg-status-red',
  unknown: 'bg-glass-edge',
};

export function AttributionAnalysisPanel({
  analysis,
  spend,
  value,
  campaignId,
  campaignName,
  platform,
  storeId,
}: Props) {
  const adAccounts = useStoreAdAccounts();
  const level = analysis.trust.level;

  // Always label by the campaign's REAL platform — never hardcode "Meta".
  // Neutral fallback keeps the copy honest when platform is undefined.
  const platformLabel = platform ?? 'הפלטפורמה';
  const detRoas = spend > 0
    ? analysis.deterministicRevenue / spend
    : 0;
  const platformRoas = spend > 0
    ? value / spend
    : 0;

  return (
    <section>
      <Heading level="panel" className="inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-ink-secondary" />
        ניתוח attribution
      </Heading>
      <div className="relative overflow-hidden rounded-xl border border-glass-edge bg-glass-2/30 p-3 space-y-3">
        {/* Trust accent bar — graphical only (not a text background). The band
            HUE lives here + in the band-chip; text never reads off it. */}
        <span className={cn('absolute inset-x-0 top-0 h-[3px]', TRUST_ACCENT[level])} aria-hidden />
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
            className="rounded-md bg-status-redBg border border-status-red text-status-redFg px-3 py-2 flex items-start gap-2 text-fs-2xs leading-relaxed"
          >
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            <div>
              <strong className="block font-semibold">הילה חריגה ({(analysis.coverage * 100).toFixed(0)}%) — בדוק את הפיקסל</strong>
              <span>
                Shopify רואה יותר מפי-2 הזמנות ממה ש-{platformLabel} דיווח — סימן
                למעקב-המרות שבור / חסום, לדריפט של חלון הייחוס, או לקמפיינים אחרים
                שמושכים הזמנות לתוך המיפוי.
              </span>
            </div>
          </div>
        )}
        {/* Header: trust verdict + score */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="shrink-0">
            <div className="text-fs-2xs uppercase tracking-wide text-ink-muted">
              ציון אמינות
            </div>
            <div className="text-2xl font-bold tabular-nums leading-tight text-ink">
              {analysis.trust.score.toFixed(0)}<span className="text-sm text-ink-muted">/100</span>
            </div>
            <span className={cn('band-chip mt-1', TRUST_CHIP[level])}>{analysis.trust.label}</span>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-fs-2xs uppercase text-ink-muted">ROAS אמיתי (click-id)</div>
                <div className="text-base font-semibold tabular-nums text-ink">
                  {detRoas > 0 ? `${detRoas.toFixed(2)}x` : '—'}
                </div>
                {analysis.roasInterval && (
                  <div className="text-fs-2xs text-ink-muted tabular-nums">
                    טווח 95%: {analysis.roasInterval.low.toFixed(2)} – {analysis.roasInterval.high.toFixed(2)}
                    {/* Bug #5b — a CI off n<5 orders is indicative only; flag it so the
                        operator doesn't read a 2-order range as statistically solid. */}
                    {analysis.deterministicOrders < SMALL_SAMPLE_ORDERS && (
                      <span className="text-status-warningFg">
                        {' '}· מדגם קטן ({analysis.deterministicOrders})
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div>
                <div className="text-fs-2xs uppercase text-ink-muted">ROAS לפי {platformLabel}</div>
                <div className="text-base font-semibold tabular-nums text-ink">
                  {platformRoas > 0 ? `${platformRoas.toFixed(2)}x` : '—'}
                </div>
                <div className="text-fs-2xs text-ink-muted tabular-nums">
                  <Money value={value} prefix="CAD" /> מדווח
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Breakdown bar: deterministic vs modeled */}
        {value > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-fs-2xs text-ink-secondary">
              <span>click-id מתויג: {analysis.deterministicOrders} הזמנות (<Money value={analysis.deterministicRevenue} prefix="CAD" />)</span>
              <span>modeled: <Money value={analysis.modeledRevenue} prefix="CAD" /></span>
            </div>
            {/* FIX-12 (5.2.2.1): clamp widths to [0, 100]; signed revenue can otherwise produce negative widths or >100% bars.
                Horizon: neutral pill-track well + two NEUTRAL fills (deterministic = solid accent ink, modeled = subtle) so the
                bar reads without deriving from the band hue. */}
            <div className="h-2.5 rounded-full bg-pill-track overflow-hidden flex">
              <div
                className="h-full bg-ink-muted"
                style={{ width: `${Math.max(0, Math.min(100, (analysis.deterministicRevenue / value) * 100))}%` }}
              />
              <div
                className="h-full bg-ink-subtle"
                style={{ width: `${Math.max(0, Math.min(100, (analysis.modeledRevenue / value) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Reasons list */}
        {analysis.reasons.length > 0 && (
          <ul className="text-fs-2xs space-y-1 leading-relaxed text-ink-secondary">
            {analysis.reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-ink-muted">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Recommendation callout */}
        {analysis.recommendation && (
          <div className="rounded-md bg-pill-track border border-glass-edge px-2.5 py-2 text-fs-2xs leading-relaxed text-ink-secondary inline-flex items-start gap-1.5">
            <Lightbulb size={13} className="shrink-0 mt-px text-ink-muted" aria-hidden />
            <span><strong className="text-ink">המלצה:</strong> {analysis.recommendation}</span>
          </div>
        )}

        {/* Window stability + outliers footer */}
        {(analysis.windowStability || analysis.outlierDays.length > 0) && (
          <div className="text-fs-2xs flex flex-wrap gap-2 pt-1 border-t border-glass-edge text-ink-muted">
            {analysis.windowStability && (
              <span>
                יציבות ({analysis.windowStability.windowCountWithData} שבועות):{' '}
                <strong className="text-ink-secondary">{analysis.windowStability.verdict === 'stable' ? 'יציב' : analysis.windowStability.verdict === 'mixed' ? 'מעורב' : 'תנודתי'}</strong>{' '}
                (σ={(analysis.windowStability.stdDev * 100).toFixed(0)}%)
              </span>
            )}
            {analysis.outlierDays.length > 0 && (
              <span>
                • <strong className="text-ink-secondary">{analysis.outlierDays.length}</strong> ימי spike מ-{platformLabel} (modeled)
              </span>
            )}
          </div>
        )}

        {/* Task 5.6 (P1-10 / Q7) — Ads Manager deep-link footer.
            Hidden primary because we already live inside the drawer. */}
        {campaignId && storeId && platform && (
          <div className="pt-2 border-t border-glass-edge">
            <InsightActions
              campaignId={campaignId}
              campaignName={campaignName}
              platform={platform}
              storeId={storeId}
              adAccounts={adAccounts}
              hidePrimary
            />
          </div>
        )}
      </div>
    </section>
  );
}

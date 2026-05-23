'use client';

/**
 * Phase 05.7.x (2026-05-23) — Multi-mapping cohort comparison panel.
 *
 * Rendered inside CampaignDrawer below the Mapped-Products panel when the
 * cohort is non-empty (current campaign shares >= 1 product with at
 * least one other campaign). The panel surfaces the operator's
 * cross-campaign performance comparison so a decision like "scale this
 * campaign" can be made WITH cohort context instead of in isolation.
 *
 * The panel renders TWO sections when both apply (Meta + TikTok with
 * shared products), or just one when the cohort is single-platform:
 *
 *   - INTRA-PLATFORM (same platform as the current campaign) —
 *     intra-platform members compete for the same audience pool on the
 *     same network. Scaling one risks cannibalising the others if the
 *     audience is saturated. Tagline: "rivals באותה זירה".
 *
 *   - CROSS-PLATFORM (different platforms) — parallel channels. Scaling
 *     usually independent of the others (different user pools).
 *     Tagline: "ערוצים מקבילים".
 *
 * The current campaign appears at the top of EACH applicable section
 * with a highlight + 🥇/🥈/🥉 chip showing its rank in the section.
 * Other members sort by ROAS Shopify desc.
 */

import { Trophy, AlertCircle, Equal, Package, TrendingDown } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { CohortMember, MultiMappingCohort } from '@/lib/multiMappingCohort';
import type { CannibalizationVerdict } from '@/lib/cannibalizationDetection';

type Props = {
  cohort: MultiMappingCohort;
  /** Phase 05.7.x (2026-05-23) — cannibalization verdicts for the
   *  cohort's shared products (one per multi-mapped product). When
   *  any verdict is `high` or `medium`, the panel renders a warning
   *  banner above the comparison tables. Empty / undefined → no
   *  banner; the panel keeps working as a pure comparison view. */
  cannibalizationVerdicts?: CannibalizationVerdict[];
  /** When the operator clicks a non-current member, the drawer can open
   *  that campaign in place. Optional — passes (campaignId, platform). */
  onDrillCampaign?: (campaignId: string, platform: string) => void;
};

function MedalIcon({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base">🥇</span>;
  if (rank === 2) return <span className="text-base">🥈</span>;
  if (rank === 3) return <span className="text-base">🥉</span>;
  return <span className="text-xs text-text-muted tabular-nums">#{rank}</span>;
}

function fmtRoas(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

/** Format a fraction as percentage with sign. 0.25 → "+25%", -0.10 → "−10%". */
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const pct = Math.round(n * 100);
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const isActive =
    status === 'ACTIVE' ||
    status === 'ENABLED' ||
    status === 'ADGROUP_STATUS_DELIVERY_OK';
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border',
        isActive
          ? 'bg-roas-greenBg/40 text-roas-green border-roas-green/30'
          : 'bg-surfaceMuted text-text-muted border-borderSubtle',
      )}
      title={status}
    >
      {isActive ? 'פעיל' : 'כבוי'}
    </span>
  );
}

type MemberRowProps = {
  member: CohortMember;
  rank: number;
  isCurrent: boolean;
  onDrill?: () => void;
  /** Show the medal only for the top 3; otherwise show "#N". */
};

function MemberRow({ member, rank, isCurrent, onDrill }: MemberRowProps) {
  const metrics = member.metrics;
  return (
    <tr
      className={cn(
        'border-b border-borderSubtle/60 last:border-0',
        isCurrent && 'bg-primary/8 font-semibold',
        !isCurrent && onDrill && 'hover:bg-surfaceMuted/60 cursor-pointer',
      )}
      onClick={!isCurrent && onDrill ? onDrill : undefined}
    >
      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <MedalIcon rank={rank} />
          {isCurrent && (
            <span className="text-[9px] uppercase tracking-wider text-primary font-bold">
              את/ה כאן
            </span>
          )}
        </span>
      </td>
      <td
        className={cn(
          'px-2 py-1.5 text-xs max-w-[200px] truncate',
          isCurrent ? 'text-text-primary' : 'text-text-secondary',
        )}
        title={member.campaignName}
      >
        {member.campaignName}
      </td>
      <td className="px-2 py-1.5 text-xs text-text-muted tabular-nums">
        {member.sharedProductIds.length}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end">
        {metrics ? `CAD ${formatCurrency(metrics.spend)}` : '—'}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end font-semibold">
        {fmtRoas(metrics?.roasShopify)}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end text-text-muted">
        {fmtRoas(metrics?.roasShopifyPlatform)}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end text-text-muted">
        {metrics ? formatNumber(metrics.conversions, 0) : '—'}
      </td>
      <td className="px-2 py-1.5 text-xs text-end">
        <StatusBadge status={metrics?.effectiveStatus ?? null} />
      </td>
    </tr>
  );
}

type SectionProps = {
  title: string;
  subtitle: string;
  members: Array<CohortMember & { isCurrent: boolean }>;
  /** Indicator for the operator: how dangerous is competition here? */
  tone: 'intra' | 'cross';
  onDrillCampaign?: (campaignId: string, platform: string) => void;
};

function CohortSection({ title, subtitle, members, tone, onDrillCampaign }: SectionProps) {
  if (members.length === 0) return null;
  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        tone === 'intra'
          ? 'border-amber-200 bg-amber-50/30'
          : 'border-borderSubtle bg-surfaceMuted/30',
      )}
    >
      <div className="px-3 py-2 border-b border-borderSubtle/60 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded',
            tone === 'intra' ? 'bg-amber-200/70 text-amber-900' : 'bg-primary/15 text-primary',
          )}
        >
          {tone === 'intra' ? <AlertCircle size={13} /> : <Equal size={13} />}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary">{title}</div>
          <div className="text-[10px] text-text-muted leading-tight">{subtitle}</div>
        </div>
      </div>
      <table className="w-full">
        <thead className="bg-surfaceMuted/50 text-text-muted">
          <tr>
            <th className="px-2 py-1 text-start font-medium text-[10px]">דירוג</th>
            <th className="px-2 py-1 text-start font-medium text-[10px]">קמפיין</th>
            <th className="px-2 py-1 text-start font-medium text-[10px]">מוצרים משותפים</th>
            <th className="px-2 py-1 text-end font-medium text-[10px]">הוצאה</th>
            <th className="px-2 py-1 text-end font-medium text-[10px]">
              ROAS Shopify
            </th>
            <th className="px-2 py-1 text-end font-medium text-[10px]">
              ROAS פלטפ.
            </th>
            <th className="px-2 py-1 text-end font-medium text-[10px]">המרות</th>
            <th className="px-2 py-1 text-end font-medium text-[10px]">סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => (
            <MemberRow
              key={m.campaignKey}
              member={m}
              rank={i + 1}
              isCurrent={m.isCurrent}
              onDrill={
                !m.isCurrent && onDrillCampaign
                  ? () => onDrillCampaign(m.campaignId, m.platform)
                  : undefined
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CohortComparisonPanel({
  cohort,
  cannibalizationVerdicts,
  onDrillCampaign,
}: Props) {
  // Phase 05.7.x (2026-05-23) — surface high/medium cannibalization
  // verdicts as a banner above the comparison tables. Sorted by
  // severity then by absolute spend growth so the worst offender is
  // first.
  const cannibalizationAlerts = (cannibalizationVerdicts ?? [])
    .filter(v => v.risk === 'high' || v.risk === 'medium' || v.risk === 'low')
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2, none: 3, insufficient: 4 };
      const sevDiff = order[a.risk] - order[b.risk];
      if (sevDiff !== 0) return sevDiff;
      return b.metrics.spendGrowthPct - a.metrics.spendGrowthPct;
    });
  // Build per-section ranked lists. Each section's ranking is INTERNAL —
  // ranking #1 in the intra-platform table doesn't necessarily mean #1
  // overall (a cross-platform member with higher ROAS could be overall
  // #1). This matches operator intuition: "of the 4 Meta campaigns on
  // this product, where do I rank?"
  const currentPlatform = cohort.current.platform;
  const intraSection: Array<CohortMember & { isCurrent: boolean }> = [
    { ...cohort.current, isCurrent: true },
    ...cohort.intraPlatformOthers.map(o => ({ ...o, isCurrent: false })),
  ];
  intraSection.sort((a, b) => {
    const sa = a.metrics ? a.metrics.roasShopify * 1e6 + a.metrics.roasShopifyPlatform * 1e3 + a.metrics.spend : -Infinity;
    const sb = b.metrics ? b.metrics.roasShopify * 1e6 + b.metrics.roasShopifyPlatform * 1e3 + b.metrics.spend : -Infinity;
    return sb - sa;
  });

  const crossSection: Array<CohortMember & { isCurrent: boolean }> = cohort.crossPlatformOthers.length > 0
    ? cohort.crossPlatformOthers.map(o => ({ ...o, isCurrent: false }))
    : [];
  crossSection.sort((a, b) => {
    const sa = a.metrics ? a.metrics.roasShopify : 0;
    const sb = b.metrics ? b.metrics.roasShopify : 0;
    return sb - sa;
  });

  const currentRankIntra = intraSection.findIndex(m => m.isCurrent) + 1;
  const intraCount = intraSection.length;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
            <Trophy size={14} className="text-text-secondary" />
            השוואה לקמפיינים שמקדמים את אותם מוצרים
          </h3>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
            הקמפיין הזה חולק מיפוי עם {cohort.others.length} קמפיינים אחרים בסך
            הכל ({cohort.sharedProductIds.length} מוצרים משותפים). ה-ROAS Shopify
            של כל קמפיין כבר מנוכה ל<strong>חלקו בהוצאה</strong> בתוך הקבוצה.
          </p>
        </div>
        {/* Overall ranking chip in the header — quick visual answer to
            "where do I stand?" without scrolling. */}
        {intraCount >= 2 && cohort.intraPlatformOthers.length > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold shrink-0 border',
              currentRankIntra === 1
                ? 'bg-roas-greenBg/60 text-roas-green border-roas-green/30'
                : currentRankIntra === intraCount
                  ? 'bg-roas-redBg/60 text-roas-red border-roas-red/30'
                  : 'bg-amber-100 text-amber-800 border-amber-300',
            )}
            title={
              currentRankIntra === 1
                ? 'אתה מוביל בקבוצת המיפוי באותה פלטפורמה'
                : currentRankIntra === intraCount
                  ? 'אתה החלש בקבוצת המיפוי באותה פלטפורמה'
                  : 'אתה באמצע הקבוצה באותה פלטפורמה'
            }
          >
            <MedalIcon rank={currentRankIntra} />
            במקום {currentRankIntra} מתוך {intraCount}
          </span>
        )}
      </div>

      {/* Phase 05.7.x (2026-05-23) — cannibalization warning banner.
          Renders when at least one shared product shows a non-trivial
          cannibalization signal. Color-coded by worst severity (red =
          high, amber = medium, blue = low). Each product is its own
          line so the operator can see exactly which mapping is the
          risk. */}
      {cannibalizationAlerts.length > 0 && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2.5 space-y-2',
            cannibalizationAlerts[0].risk === 'high'
              ? 'bg-roas-redBg/60 border-roas-red/40'
              : cannibalizationAlerts[0].risk === 'medium'
                ? 'bg-amber-100 border-amber-300'
                : 'bg-primary/10 border-primary/30',
          )}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <TrendingDown
              size={14}
              className={cn(
                cannibalizationAlerts[0].risk === 'high'
                  ? 'text-roas-red'
                  : cannibalizationAlerts[0].risk === 'medium'
                    ? 'text-amber-800'
                    : 'text-primary',
              )}
            />
            <span className="text-text-primary">
              ⚠️ סימני קניבליזציה — הוצאה גדלה בלי שההכנסה תלך אחריה
            </span>
          </div>
          <ul className="space-y-1.5">
            {cannibalizationAlerts.map(v => (
              <li
                key={v.productId}
                className="text-[11px] text-text-secondary leading-relaxed"
              >
                <strong className="text-text-primary">{v.productTitle}</strong>{' '}
                <span
                  className={cn(
                    'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider align-middle',
                    v.risk === 'high'
                      ? 'bg-roas-red/30 text-roas-red'
                      : v.risk === 'medium'
                        ? 'bg-amber-300 text-amber-900'
                        : 'bg-primary/25 text-primary',
                  )}
                >
                  {v.risk === 'high' ? 'גבוה' : v.risk === 'medium' ? 'בינוני' : 'נמוך'}
                </span>
                <br />
                <span className="text-text-muted">
                  הוצאת קבוצה: CAD {formatCurrency(v.metrics.earlyHalfSpend)} →{' '}
                  CAD {formatCurrency(v.metrics.lateHalfSpend)} ({fmtPct(v.metrics.spendGrowthPct)}) ·
                  הכנסת מוצר: CAD {formatCurrency(v.metrics.earlyHalfRevenue)} →{' '}
                  CAD {formatCurrency(v.metrics.lateHalfRevenue)} ({fmtPct(v.metrics.revenueGrowthPct)})
                  {v.metrics.marginalRoas !== null && (
                    <>
                      {' '}· ROAS שולי: {v.metrics.marginalRoas.toFixed(2)}
                    </>
                  )}
                </span>
                <br />
                <span className="text-text-secondary">{v.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CohortSection
        title={`קמפיינים מאותה פלטפורמה (${currentPlatform})`}
        subtitle="מתחרים על אותו קהל. סקייל באחד עלול לגנוב נתח מהאחרים אם הקהל רווי."
        members={intraSection}
        tone="intra"
        onDrillCampaign={onDrillCampaign}
      />

      {crossSection.length > 0 && (
        <CohortSection
          title="ערוצים מקבילים (פלטפורמות אחרות)"
          subtitle="קהלים שונים. בדרך כלל סקייל לא קניבליסטי — הוסיף עוד נפח בלי להזיק לזה."
          members={[
            // The current campaign isn't a cross-platform member of itself,
            // but we include it (greyed) at the top so the operator has a
            // reference baseline to compare cross-platform members against.
            { ...cohort.current, isCurrent: true },
            ...crossSection,
          ]}
          tone="cross"
          onDrillCampaign={onDrillCampaign}
        />
      )}

      {/* Educational footer — explains the ranking + revenue split so the
          operator understands what the table means and what action to take. */}
      <div className="rounded-lg bg-surfaceMuted/40 border border-borderSubtle px-3 py-2 text-[10px] text-text-secondary leading-relaxed inline-flex items-start gap-1.5">
        <Package size={11} className="text-text-muted mt-0.5 shrink-0" />
        <span>
          <strong>איך לקרוא:</strong> ROAS Shopify של כל קמפיין מבוסס על חלקו
          בהוצאה בתוך הקבוצה (אם 4 קמפיינים מקדמים אותו מוצר וכל אחד הוציא 25%
          מההוצאה הכוללת — כל אחד יקבל 25% מההכנסה). אם אתה מנצח בקבוצת המיפוי
          וההוצאה שלך גבוהה — סקייל הוא הימור בטוח. אם אתה החלש בקבוצה — אולי
          שווה לעצור או לרענן קריאייטיב לפני סקייל.
        </span>
      </div>
    </section>
  );
}

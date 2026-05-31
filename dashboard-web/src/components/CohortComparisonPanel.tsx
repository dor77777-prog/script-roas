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
  return <span className="text-xs text-ink-muted tabular-nums">#{rank}</span>;
}

function fmtRoas(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

/**
 * Lexicographic comparator for `intraSection` cohort members. Sort order:
 *   1. roasShopify desc           (the primary signal — combined ROAS)
 *   2. roasShopifyPlatform desc   (secondary tiebreak — deterministic ROAS)
 *   3. spend desc                 (tertiary tiebreak — bigger spender first)
 * Missing-metrics rows sink to the bottom (return positive for `a` missing).
 *
 * HIGH-6 audit fix (2026-05-23): replaces the pre-fix composite key
 * `roasShopify * 1e6 + roasShopifyPlatform * 1e3 + spend` which silently
 * overflowed the 1e6/1e3 weight bands when `roasShopifyPlatform` reached
 * extreme values (e.g. micro-spend cohorts where a tiny denominator
 * inflated `roasShopifyPlatform` to ~5000). In that case the secondary
 * key overruled the primary — the panel showed a noise-driven winner
 * instead of the actual best-performing campaign by combined ROAS.
 *
 * Example regression: roasShopify=2 + roasShopifyPlatform=5000 + spend=10
 *   composite = 2*1e6 + 5000*1e3 + 10  = 7,000,010
 * vs. roasShopify=3 + roasShopifyPlatform=4 + spend=10
 *   composite = 3*1e6 + 4*1e3 + 10     = 3,004,010
 * Composite flipped the winner; lexicographic correctly picks the
 * roasShopify=3 cohort.
 *
 * Exported so the regression suite can pin this exact behavior.
 */
export function compareIntraSectionMembers(
  a: CohortMember,
  b: CohortMember,
): number {
  const am = a.metrics;
  const bm = b.metrics;
  if (!am && !bm) return 0;
  if (!am) return 1;
  if (!bm) return -1;
  if (am.roasShopify !== bm.roasShopify) return bm.roasShopify - am.roasShopify;
  if (am.roasShopifyPlatform !== bm.roasShopifyPlatform) {
    return bm.roasShopifyPlatform - am.roasShopifyPlatform;
  }
  return bm.spend - am.spend;
}

/**
 * Format a fraction as percentage with sign. 0.25 → "+25%", -0.10 → "−10%".
 *
 * Audit fix 2026-05-23 (HIGH-11 / O3-HI-03): accept `number | null` and
 * render the missing-value case as "n/a" (Hebrew "לא מוגדר"). The
 * cannibalization detector now emits `null` instead of `Infinity` when
 * early revenue is 0 with positive late revenue — see
 * `revenueGrowthPct` in `cannibalizationDetection.ts`.
 */
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'לא מוגדר';
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
          ? 'bg-status-greenBg/40 text-status-green border-status-green/30'
          : 'bg-glass-2 text-ink-muted border-glass-edge',
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
        'border-b border-glass-edge/60 last:border-0',
        isCurrent && 'bg-accent/8 font-semibold',
        !isCurrent && onDrill && 'hover:bg-glass-2/60 cursor-pointer',
      )}
      onClick={!isCurrent && onDrill ? onDrill : undefined}
    >
      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <MedalIcon rank={rank} />
          {isCurrent && (
            <span className="text-[9px] uppercase tracking-wider text-accent font-bold">
              את/ה כאן
            </span>
          )}
        </span>
      </td>
      <td
        className={cn(
          'px-2 py-1.5 text-xs max-w-[200px] truncate',
          isCurrent ? 'text-ink' : 'text-ink-secondary',
        )}
        title={member.campaignName}
      >
        {member.campaignName}
      </td>
      <td className="px-2 py-1.5 text-xs text-ink-muted tabular-nums">
        {member.sharedProductIds.length}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end">
        {metrics ? `CAD ${formatCurrency(metrics.spend)}` : '—'}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end font-semibold">
        {fmtRoas(metrics?.roasShopify)}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end text-ink-muted">
        {fmtRoas(metrics?.roasShopifyPlatform)}
      </td>
      <td className="px-2 py-1.5 text-xs tabular-nums text-end text-ink-muted">
        {metrics ? formatNumber(metrics.conversions, 0) : '—'}
      </td>
      <td className="px-2 py-1.5 text-xs text-end">
        {/* Phase D (2026-05-30) — prefer reg_effective_status; fall back
            to legacy. */}
        <StatusBadge status={metrics?.regEffectiveStatus ?? metrics?.effectiveStatus ?? null} />
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
        'rounded-lg border overflow-x-auto',
        tone === 'intra'
          ? 'border-status-warning/30 bg-status-warningBg/30'
          : 'border-glass-edge bg-glass-2/30',
      )}
    >
      <div className="px-3 py-2 border-b border-glass-edge/60 flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded',
            tone === 'intra' ? 'bg-status-warning/70 text-status-warningFg' : 'bg-accent/15 text-accent',
          )}
        >
          {tone === 'intra' ? <AlertCircle size={13} /> : <Equal size={13} />}
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-ink">{title}</div>
          <div className="text-[10px] text-ink-muted leading-tight">{subtitle}</div>
        </div>
      </div>
      <table className="w-full min-w-[640px]">
        <thead className="bg-glass-2/50 text-ink-muted">
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
      // Audit fix 2026-05-23: `composition_changed` added to risk type
      // but intentionally excluded from the alert sort (it's surfaced
      // separately as an info banner below, not as a severity).
      const order: Record<CannibalizationVerdict['risk'], number> = {
        high: 0,
        medium: 1,
        low: 2,
        none: 3,
        insufficient: 4,
        composition_changed: 5,
      };
      const sevDiff = order[a.risk] - order[b.risk];
      if (sevDiff !== 0) return sevDiff;
      return b.metrics.spendGrowthPct - a.metrics.spendGrowthPct;
    });
  // Audit fix 2026-05-23 (HIGH-03 multi-mapping): composition-change
  // verdicts surface as an info banner — operator should understand
  // why the cannibalization analysis is suppressed for these products.
  const compositionChangedAlerts = (cannibalizationVerdicts ?? [])
    .filter(v => v.risk === 'composition_changed');
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
  // HIGH-6 audit fix (2026-05-23): explicit lexicographic compare on
  // (roasShopify desc, roasShopifyPlatform desc, spend desc). Extracted
  // into `compareIntraSectionMembers` (exported) so the regression suite
  // can pin the contract without standing up the full component tree.
  intraSection.sort(compareIntraSectionMembers);

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
          <h3 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
            <Trophy size={14} className="text-ink-secondary" />
            השוואה לקמפיינים שמקדמים את אותם מוצרים
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">
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
                ? 'bg-status-greenBg/60 text-status-green border-status-green/30'
                // Audit fix 2026-05-23 (HIGH-02 multi-mapping): only paint
                // the loud red "weakest" tone when the cohort is large
                // enough for the verdict to mean something (>= 3 members).
                // For a 2-cohort the loser is automatically "weakest" by
                // construction — not actionable signal. Matches the
                // floor in `applyCohortAdjustmentOnce`.
                : intraCount >= 3 && currentRankIntra === intraCount
                  ? 'bg-status-redBg/60 text-status-red border-status-red/30'
                  : 'bg-status-warningBg text-status-warningFg border-status-warning/30',
            )}
            title={
              currentRankIntra === 1
                ? 'אתה מוביל בקבוצת המיפוי באותה פלטפורמה'
                : intraCount >= 3 && currentRankIntra === intraCount
                  ? 'אתה החלש בקבוצת המיפוי באותה פלטפורמה'
                  : 'אתה במיפוי משותף — דירוג בלבד'
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
              ? 'bg-status-redBg/60 border-status-red/40'
              : cannibalizationAlerts[0].risk === 'medium'
                ? 'bg-status-warningBg border-status-warning/30'
                : 'bg-accent/10 border-accent/30',
          )}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <TrendingDown
              size={14}
              className={cn(
                cannibalizationAlerts[0].risk === 'high'
                  ? 'text-status-red'
                  : cannibalizationAlerts[0].risk === 'medium'
                    ? 'text-status-warningFg'
                    : 'text-accent',
              )}
            />
            <span className="text-ink">
              ⚠️ סימני קניבליזציה — הוצאה גדלה בלי שההכנסה תלך אחריה
            </span>
          </div>
          <ul className="space-y-1.5">
            {cannibalizationAlerts.map(v => (
              <li
                key={v.productId}
                className="text-[11px] text-ink-secondary leading-relaxed"
              >
                <strong className="text-ink">{v.productTitle}</strong>{' '}
                <span
                  className={cn(
                    'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider align-middle',
                    v.risk === 'high'
                      ? 'bg-status-red/30 text-status-red'
                      : v.risk === 'medium'
                        ? 'bg-status-warning text-status-warningFg'
                        : 'bg-accent/25 text-accent',
                  )}
                >
                  {v.risk === 'high' ? 'גבוה' : v.risk === 'medium' ? 'בינוני' : 'נמוך'}
                </span>
                <br />
                <span className="text-ink-muted">
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
                <span className="text-ink-secondary">{v.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Audit fix 2026-05-23 (HIGH-03 multi-mapping): composition-change
          info banner. Surfaces when the cohort's spend ↔ revenue comparison
          is suppressed because a material member was launched or paused
          mid-range — operator should understand WHY the cannibalization
          analysis is empty for these products instead of inferring "all is
          well". Distinct visual treatment (neutral surfaceMuted, not the
          red/amber/blue severity tones) so it doesn't read as an alarm. */}
      {compositionChangedAlerts.length > 0 && (
        <div className="rounded-lg border border-glass-edge bg-glass-2/40 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-secondary">
            <TrendingDown size={14} className="text-ink-muted" />
            <span>ניתוח קניבליזציה מושהה — הרכב הקבוצה השתנה בתוך הטווח</span>
          </div>
          <ul className="space-y-1.5">
            {compositionChangedAlerts.map(v => (
              <li
                key={v.productId}
                className="text-[11px] text-ink-secondary leading-relaxed"
              >
                <strong className="text-ink">{v.productTitle}</strong>
                <br />
                <span className="text-ink-muted">{v.reason}</span>
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
      <div className="rounded-lg bg-glass-2/40 border border-glass-edge px-3 py-2 text-[10px] text-ink-secondary leading-relaxed inline-flex items-start gap-1.5">
        <Package size={11} className="text-ink-muted mt-0.5 shrink-0" />
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

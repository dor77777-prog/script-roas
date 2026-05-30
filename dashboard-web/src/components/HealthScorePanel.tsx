'use client';

import { cn } from '@/lib/utils';
import type {
  CampaignHealth,
  HealthGrade,
} from '@/lib/campaignHealthScore';
import { InsightCard } from '@/components/ui/InsightCard';

/**
 * Inline (always-expanded) Health Score panel for the campaign drawer.
 *
 * Mirrors `HealthScoreBadge`'s popover content but renders inline at the
 * top of the drawer — the operator opens a campaign and immediately sees
 * the unified verdict + breakdown that drove it, with recommendations
 * derived from the weakest component. Same algorithm as the badge: this
 * component is just a different surface for the same `CampaignHealth`.
 *
 * Why a second component instead of "expanded badge": the drawer panel is
 * larger (lg badge, larger bars, recommendation rail) and never collapses,
 * while the table badge needs to fit in a 78px cell and stay collapsed by
 * default. Composing two visuals from the same data keeps the design
 * language consistent (component bars + reason strings) without forcing
 * the badge to handle both modes.
 */

const GRADE_STYLES: Record<HealthGrade, { chip: string; ring: string; label: string; tone: string }> = {
  A: { chip: 'bg-status-greenBg text-status-green', ring: 'ring-status-green/30', label: 'מצוין', tone: 'text-status-green' },
  B: { chip: 'bg-status-blueBg text-status-blue', ring: 'ring-status-blue/30', label: 'בריא', tone: 'text-status-blue' },
  C: { chip: 'bg-status-orangeBg text-status-orange', ring: 'ring-status-orange/30', label: 'גבולי', tone: 'text-status-orange' },
  D: { chip: 'bg-status-redBg text-status-red', ring: 'ring-status-red/30', label: 'בעייתי', tone: 'text-status-red' },
  F: { chip: 'bg-status-redBg text-status-red', ring: 'ring-status-red/40', label: 'כשל', tone: 'text-status-red' },
  unknown: { chip: 'bg-elevated2 text-ink-muted', ring: 'ring-line-subtle', label: 'מוקדם מדי', tone: 'text-ink-muted' },
};

type WeightedComponentKey = 'profitability' | 'volume' | 'trajectory' | 'attributionClarity';

const COMPONENT_LABELS: Record<WeightedComponentKey, { label: string; weight: string }> = {
  profitability:       { label: 'רווחיות',           weight: '40%' },
  volume:              { label: 'נפח',                weight: '15%' },
  trajectory:          { label: 'מומנטום',            weight: '25%' },
  attributionClarity:  { label: 'אמינות attribution', weight: '20%' },
};

const COMPONENT_ORDER: ReadonlyArray<WeightedComponentKey> = [
  'profitability',
  'volume',
  'trajectory',
  'attributionClarity',
];

function barColor(value: number): string {
  if (value >= 75) return 'bg-status-green';
  if (value >= 50) return 'bg-status-blue';
  if (value >= 30) return 'bg-status-orange';
  return 'bg-status-red';
}

/**
 * Derive a recommendation block based on the SCORE'S WEAKEST COMPONENT.
 * The user complaint that drove this whole subsystem was "the conclusions
 * are disconnected" — the recommendation here is intentionally derived
 * from the same numbers that drove the grade, so the operator sees a
 * single coherent story rather than 5 chips pointing in 5 directions.
 */
function buildRecommendations(health: CampaignHealth): string[] {
  if (health.insufficient) {
    return [
      'חכה שיצטברו נתונים — הקמפיין עדיין בשלב למידה ואין מספיק מדגם לקבוע מסקנות.',
    ];
  }

  const { components } = health;
  const weakest = COMPONENT_ORDER
    .map((k) => ({ key: k, value: components[k] }))
    .sort((a, b) => a.value - b.value)[0];

  const out: string[] = [];

  // Headline recommendation by weakest component.
  switch (weakest.key) {
    case 'profitability':
      if (weakest.value < 30) {
        out.push(
          'הציון מושך מטה ע״י רווחיות נמוכה — ROAS מתחת לסף או אמינות חלשה. שקול לעצור את הקמפיין, להחליף יצירתיים, או לבחון מחדש את קהל היעד.',
        );
      } else {
        out.push(
          'רווחיות גבולית — לפני שתסקייל, ודא ש-ROAS הוא אמיתי (השווה ROAS פלטפורמה ל-ROAS Shopify, ובדוק שמיפוי המוצרים שלם).',
        );
      }
      break;
    case 'volume':
      out.push(
        'נפח ההוצאה קטן מדי כדי לסמוך על המספרים — שקול להגדיל הוצאה או להאריך את תקופת הבדיקה לפני קבלת החלטות.',
      );
      break;
    case 'trajectory':
      if (weakest.value === 0) {
        out.push(
          'המגמה שלילית — CPM עולה ו-ROAS יורד יחד. סימן ל-creative fatigue או שינוי בקהל. שקול לרענן יצירתיים או לבחון את הקהל מחדש.',
        );
      } else if (weakest.value === 40) {
        out.push(
          'אזהרה במגמה — CPM ו-ROAS עולים יחד. סימן לתחרות גוברת. בדוק את האיכות של היצירתיים מול המתחרים.',
        );
      } else {
        out.push(
          'המגמה נייטרלית או נטולת מספיק היסטוריה. חזור לבדוק בעוד מספר ימים כאשר תהיה מגמה ברורה.',
        );
      }
      break;
    case 'attributionClarity':
      out.push(
        'כיסוי click-ID חלש (utm_source / fbclid / gclid / ttclid לא נתפסים מספיק). בדוק את ה-URL Parameters בפלטפורמה ואת מצב Pixel/Conversion API.',
      );
      break;
  }

  return out;
}

export function HealthScorePanel({ health }: { health: CampaignHealth }) {
  const styles = GRADE_STYLES[health.grade];
  const isUnknown = health.grade === 'unknown';
  const recommendations = buildRecommendations(health);

  return (
    <InsightCard
      tone="neutral"
      title="ציון בריאות קמפיין"
      className="space-y-4"
    >
      {/* Top row: grade badge + label + score */}
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          className={cn(
            'inline-flex items-center justify-center shrink-0',
            'min-w-[56px] h-[56px] sm:min-w-[64px] sm:h-[64px]',
            'rounded-xl text-2xl sm:text-3xl font-bold ring-1',
            styles.chip,
            styles.ring,
          )}
        >
          {isUnknown ? '⏳' : health.grade}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className={cn('text-base sm:text-lg font-semibold tracking-tight', styles.tone)}>
              {styles.label}
            </div>
            {!isUnknown && (
              <div className="text-sm text-ink-muted tabular-nums">
                ציון <span className="font-semibold text-ink">{health.score}</span>
                <span className="text-ink-subtle"> / 100</span>
              </div>
            )}
          </div>
          <div className="text-[11px] sm:text-xs text-ink-secondary mt-1 leading-relaxed">
            ציון מאוחד שמשקלל את 4 הרכיבים הקיימים בדשבורד לכדי תמונה אחת. שאר הסקציות בעמוד מציגות את המרכיבים בפירוט.
          </div>
        </div>
      </div>

      {/* Insufficient short-circuit — render reasons only */}
      {health.insufficient ? (
        <div className="rounded-lg bg-elevated2/40 border border-line-subtle px-3 py-2.5 text-[12px] text-ink-secondary leading-relaxed">
          {health.reasons[0]}
        </div>
      ) : (
        <>
          {/* Component bars — same 4 rows as the badge popover, larger */}
          <div className="space-y-2.5">
            {COMPONENT_ORDER.map((key, idx) => {
              const value = health.components[key];
              const meta = COMPONENT_LABELS[key];
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-[12px] sm:text-[13px] mb-1">
                    <span className="font-medium text-ink">
                      {meta.label}
                      <span className="text-ink-muted font-normal ms-1.5">({meta.weight})</span>
                    </span>
                    <span className="tabular-nums text-ink-secondary font-semibold">
                      {value}/100
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-elevated2 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', barColor(value))}
                      style={{ width: `${Math.max(2, value)}%` }}
                    />
                  </div>
                  <div className="text-[11px] sm:text-[12px] text-ink-muted leading-snug mt-1">
                    {health.reasons[idx]}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recommendations — derived from the SAME numbers that drove
              the grade, so the verdict and the action live in the same
              voice (vs. the old world where 5 separate chips suggested
              5 separate things). */}
          {recommendations.length > 0 && (
            <div className="pt-3 border-t border-line-subtle">
              <div className="text-[11px] sm:text-xs font-semibold text-ink mb-1.5 uppercase tracking-wide">
                המלצה
              </div>
              <ul className="space-y-1.5">
                {recommendations.map((r, idx) => (
                  <li
                    key={idx}
                    className="text-[12px] sm:text-[13px] text-ink-secondary leading-relaxed flex gap-1.5"
                  >
                    <span className="text-ink-muted shrink-0">←</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer formula reference — keep tiny, just so a curious
              operator can verify how the score was assembled. */}
          <div className="pt-2 border-t border-line-subtle text-[10.5px] sm:text-[11px] text-ink-muted leading-snug">
            ציון = (רווחיות×0.40) + (נפח×0.15) + (מומנטום×0.25) + (attribution×0.20)
          </div>
        </>
      )}
    </InsightCard>
  );
}

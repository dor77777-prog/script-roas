import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { HelpTooltip } from '@/components/ui/Tooltip';

/**
 * DQ-6 — CohortAsOfBadge. The "עודכן ל-" freshness flag shown next to the
 * cohort / LTV section title on the customers (לקוחות) tab.
 *
 * It surfaces last-success of the weekly cohort refresh so the operator can
 * tell at a glance whether the LTV / cohort numbers are current or stale:
 *
 *   • asOf null         → render nothing (no record → no false "updated" claim)
 *   • age ≤ 7d (fresh)  → blue "info" Badge, "עודכן: DD/MM"
 *   • age > 7d (stale)  → orange "warning" Badge, "עודכן: DD/MM ⚠" + a
 *                         HelpTooltip explaining the weekly cadence.
 *
 * Mirrors docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html
 * (DQ-6 card). Token-driven via the Badge primitive (blue/warning on-color
 * tokens, AA in both themes); the date is LTR-isolated via <bdi>; the caveat
 * is routed through HelpTooltip because native title= is banned by the lint
 * guard.
 *
 * `now` is an optional ISO seam so the age math is deterministic under test;
 * when omitted it reads the current instant via the standard Date API.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const STALE_TOOLTIP = 'נתוני קוהורט מתעדכנים שבועית (שני 04:00)';

/** Format an ISO instant as DD/MM in Israel time (zero-padded, LTR digits). */
function formatDayMonthIsrael(iso: string): string {
  // en-GB yields DD/MM/YYYY in Asia/Jerusalem; we keep only DD/MM.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));
  return parts; // e.g. "03/06"
}

export function CohortAsOfBadge({
  asOf,
  now,
}: {
  asOf: string | null;
  now?: string;
}) {
  // No record → no badge. (Matches the mockup's "—" / nothing state.)
  if (asOf == null) return null;

  const asOfMs = new Date(asOf).getTime();
  const nowMs = now ? new Date(now).getTime() : Date.now();
  const ageMs = nowMs - asOfMs;

  // ≤7d is fresh (boundary inclusive); strictly older than 7d is stale.
  const isStale = ageMs > SEVEN_DAYS_MS;
  const tone: BadgeTone = isStale ? 'warning' : 'blue';
  // The mockup labels the blue (fresh) state "info"; expose that intent on
  // the DOM (data-tone) so call sites / tests can assert it without leaking
  // the underlying palette name.
  const dataTone = isStale ? 'warning' : 'info';

  const label = formatDayMonthIsrael(asOf);

  const badge = (
    <Badge
      tone={tone}
      data-tone={dataTone}
      data-testid="cohort-as-of-badge"
      className={isStale ? 'cursor-help' : undefined}
    >
      <span>עודכן:</span>
      <bdi dir="ltr">{label}</bdi>
      {/* Stale glyph — uses the emoji-presentation warning sign (U+26A0 +
          VS16) that the no-emoji-in-jsx editorial allowlist permits; the
          mockup's bare U+26A0 renders identically. */}
      {isStale && <span aria-hidden="true">⚠️</span>}
    </Badge>
  );

  // Fresh: bare badge, no tooltip noise. Stale: wrap in the weekly-cadence
  // caveat (routed through HelpTooltip — native title= is banned).
  if (!isStale) return badge;

  return <HelpTooltip content={STALE_TOOLTIP}>{badge}</HelpTooltip>;
}

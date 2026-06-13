// dashboard-web/src/components/CampaignDrawerStatusSection.tsx
//
// Phase D (2026-05-30) — full status + freshness section. Expanded from
// the Phase C minimal panel. Displays the 3 status fields side-by-side
// (configured / effective / delivery), the BACKFILL_UNKNOWN sentinel
// warning when relevant, and a 3-event status-change timeline.
//
// Server-fetched on parent; receives props synchronously.
//
// Horizon re-skin (W4.3): tokens-only (pill-track insets + status tokens),
// lucide (Hourglass, no emoji), `cn()` className composition (no string
// concat), and the proper-specificity ink-secondary heading (the prior
// `!text-ink-secondary` !important override is gone). Raw platform status
// ENUMS stay verbatim & visible (operator-locked no-info-loss) — each chip
// shows a Hebrew gloss plus the raw LTR enum as a muted sub-label AND in
// `title=`; an unknown enum renders raw, never hidden.

import { Hourglass } from 'lucide-react';
import { Heading } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';

export type CampaignDrawerStatusSectionProps = {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastStatusSuccessAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
};

function relMin(min: number | null): string {
  if (min === null) return '—';
  if (min < 60)      return `${min} דק׳ לפני`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} שע׳ לפני`;
  return `${Math.floor(min / 1440)} ימים לפני`;
}

function relIso(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return relMin(min);
}

// ────────────────────────────────────────────────────────────────────────
// Raw platform status ENUM → Hebrew gloss. Operator-locked no-info-loss:
// the chip shows the Hebrew word for at-a-glance reading, but the RAW enum
// is ALWAYS rendered too (a muted LTR sub-label + `title=`), so nothing the
// platform reported is ever hidden. An enum WITHOUT a known gloss falls
// through to rendering the raw enum on its own (no Hebrew line) — never
// dropped. Covers the Meta/Google/TikTok configured + effective + delivery
// vocabularies seen across the 3 ad accounts.
// ────────────────────────────────────────────────────────────────────────
const STATUS_HE: Record<string, string> = {
  // configured / effective
  ENABLED:  'מופעל',
  ACTIVE:   'פעיל',
  PAUSED:   'מושהה',
  DISABLED: 'מושבת',
  ARCHIVED: 'בארכיון',
  DELETED:  'נמחק',
  REMOVED:  'הוסר',
  PENDING:  'ממתין',
  // delivery
  DELIVERING:     'פעיל',
  NOT_DELIVERING: 'לא פעיל',
  LIMITED:        'מוגבל',
  PENDING_REVIEW: 'בבדיקה',
  LEARNING:       'בלמידה',
  REJECTED:       'נדחה',
  UNKNOWN:        'לא ידוע',
};

// Per-enum tone (delivery semantics). Falls back to a neutral pill-track tone
// for any enum without a dedicated tone (the raw enum still shows).
const STATUS_TONE: Record<string, string> = {
  DELIVERING:     'bg-status-greenBg text-status-greenFg',
  ACTIVE:         'bg-status-greenBg text-status-greenFg',
  ENABLED:        'bg-status-greenBg text-status-greenFg',
  NOT_DELIVERING: 'bg-pill-track text-ink-secondary',
  PAUSED:         'bg-pill-track text-ink-secondary',
  DISABLED:       'bg-pill-track text-ink-secondary',
  LIMITED:        'bg-status-orangeBg text-status-orangeFg',
  PENDING_REVIEW: 'bg-status-blueBg text-status-blueFg',
  LEARNING:       'bg-status-blueBg text-status-blueFg',
  PENDING:        'bg-status-blueBg text-status-blueFg',
  REJECTED:       'bg-status-redBg text-status-redFg',
  UNKNOWN:        'bg-pill-track text-ink-muted',
};

const NEUTRAL_TONE = 'bg-pill-track text-ink';

function statusTone(status: string | null): string {
  if (!status) return 'bg-pill-track text-ink-muted';
  return STATUS_TONE[status] ?? NEUTRAL_TONE;
}

/**
 * A tinted status chip. It leads with the Hebrew gloss (when known) and ALWAYS
 * carries the raw enum — as a muted LTR sub-label and in `title=` — so the
 * exact platform value is never lost. A null value renders the em-dash. An enum
 * without a known gloss renders the raw value alone (never hidden).
 */
function StatusChip({ status, tone }: { status: string | null; tone: string }) {
  const he = status ? STATUS_HE[status] : undefined;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium',
        tone,
      )}
      title={status ?? undefined}
    >
      {status == null ? (
        '—'
      ) : (
        <>
          {he && <span>{he}</span>}
          <bdi dir="ltr" className={cn('font-mono', he && 'text-fs-2xs opacity-70')}>
            {status}
          </bdi>
        </>
      )}
    </span>
  );
}

/** A status field: the LTR caption (configured/effective/delivery) over the
 *  tinted {@link StatusChip}. */
function StatusField({
  caption,
  status,
  tone,
}: {
  caption: string;
  status: string | null;
  tone: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-fs-2xs text-ink-secondary"><bdi dir="ltr">{caption}</bdi></span>
      <StatusChip status={status} tone={tone} />
    </div>
  );
}

export function CampaignDrawerStatusSection(p: CampaignDrawerStatusSectionProps) {
  const isBackfillUnknown = p.configuredStatus === 'BACKFILL_UNKNOWN';

  return (
    <section className="border border-glass-edge rounded-hz p-4 my-3">
      <Heading level="panel" className="font-medium mb-3">סטטוס + טריות</Heading>

      {/* Phase D — Top row: 3 status chips side by side. Stacks to a single
          column on phones so the chip labels don't truncate. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        {/* configured — the BACKFILL_UNKNOWN sentinel takes a dedicated
            "loading from platform" treatment (Hourglass + warning tint);
            the raw sentinel stays available via `title=` + the explainer. */}
        <div className="flex flex-col items-start gap-1">
          <span className="text-fs-2xs text-ink-secondary"><bdi dir="ltr">configured</bdi></span>
          {isBackfillUnknown ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-status-warningBg text-status-warningFg border border-status-warning"
              title="BACKFILL_UNKNOWN"
            >
              <Hourglass size={11} aria-hidden />
              טוען מ-Platform
            </span>
          ) : (
            <StatusChip status={p.configuredStatus} tone={statusTone(p.configuredStatus)} />
          )}
        </div>
        <StatusField caption="effective" status={p.effectiveStatus} tone={statusTone(p.effectiveStatus)} />
        <StatusField caption="delivery" status={p.deliveryStatus} tone={statusTone(p.deliveryStatus)} />
      </div>

      {/* BACKFILL_UNKNOWN explainer — only when active. */}
      {isBackfillUnknown && (
        <p className="text-fs-xs text-status-warningFg bg-status-warningBg border border-status-warning rounded-md px-2 py-1 mb-3">
          הסטטוס המוגדר מ-platform עדיין לא נדגם — המערכת מילאה את השדה
          באופן זמני מתוך הנתון היומי. הערך האמיתי ימולא בעוד עד 10 דקות
          ע״י ה-status worker.
        </p>
      )}

      {/* Phase D — 3-event timeline. */}
      <div className="border-t border-glass-edge pt-3">
        <Heading as="h4" level="panel" className="text-fs-xs font-medium text-ink-secondary mb-2">היסטוריית סטטוס</Heading>
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-ink-secondary">נראה לראשונה</span>
          <span className="text-ink">{relIso(p.firstSeenAt)}</span>
          <span className="text-ink-secondary">שינוי סטטוס אחרון</span>
          <span className="text-ink">{relIso(p.statusChangedAt)}</span>
          <span className="text-ink-secondary">סטטוס נדגם בהצלחה</span>
          <span className="text-ink">{relIso(p.lastStatusSuccessAt)}</span>
          {/* LTR identifiers in an RTL parent. Wrap each in <bdi dir="ltr">
              so the parent grid logical-row order stays stable and the
              English glyph string doesn't bleed into the Hebrew column on
              re-flow. The Hebrew labels above don't need <bdi> because they
              already inherit the document direction cleanly. */}
          <span className="text-ink-secondary"><bdi dir="ltr">last_live_tick</bdi></span>
          <span className="text-ink">{relIso(p.lastLiveTickAt)}</span>
          <span className="text-ink-secondary"><bdi dir="ltr">metrics lag</bdi></span>
          <span className="text-ink">{relMin(p.metricsLagMinutes)}</span>
        </div>
      </div>
    </section>
  );
}

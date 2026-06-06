'use client';

/**
 * Phase 3, Task C — <ActivityFeed> Home consumer (REAL-TIME Shopify feed).
 *
 * Rebuilt 2026-06-01: this card no longer surfaces campaign-STATUS events. It
 * now polls `/api/store-events` (SWR, 12s) and renders the real-time Shopify
 * activity stream — sale / refund / add-to-cart — across all 3 stores, with a
 * LIVE badge wired to the webhook stream's actual listening state.
 *
 * (The campaign-status events it used to show were ALSO already rendered by the
 * operator console's <StatusEventsFeed>, so this repurpose loses no information
 * — the operator surface still carries them via its own status-events route.)
 *
 * LIVE-badge state machine (the key element — it must read as genuinely
 * real-time vs the dashboard's ~10-min cadence). Derived from the read route's
 * `lastReceivedAt` / `serverNow` (server clock, so no browser-clock skew) plus
 * the SWR error:
 *   • listening  (GREEN, pulsing "LIVE" + last-event relative time) — the poll
 *                 succeeds AND an event landed within LOOKBACK_MS.
 *   • idle       (GRAY  "מאזין") — the poll succeeds but no event in the window.
 *   • disconnected (RED "נותק") — the SWR read itself errored (route failing).
 * The pulse + new-row slide-in respect `prefers-reduced-motion` (the global CSS
 * sweep neutralises durations; we ALSO gate the animation CLASSES so a reduced-
 * motion session never queues them at all).
 *
 * Token-only: every colour comes from the status/store tokens (sale=green /
 * refund=red / add_to_cart=blue, store dots via the canonical `--store-*`
 * tokens). No raw hex/rgb/oklch/px in this file (the designColorGuard enforces
 * it). Numbers render through the shared <Money> primitive (CAD, overflow-safe,
 * `<bdi dir="ltr">`). DB-sourced strings (product titles) render as TEXT only —
 * React escapes them; we never use dangerouslySetInnerHTML.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { ShoppingBag, Undo2, ShoppingCart, Zap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/Button';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { STORE_ID_TO_NAME, type StoreId } from '@/lib/platformsByStore';
import { storeColor } from '@/lib/storeColors';
import type { StoreEventRow } from '@/lib/webhooks/store';
import type { StoreEventsResponse } from '@/app/api/store-events/route';

/* --------------------------------------------------------------------------
 * Props — same store-filter contract the Home tab already passes.
 * -------------------------------------------------------------------------- */

export interface ActivityFeedProps {
  /** Optional store filter — pass 'All' / undefined to show every store. */
  store?: string;
  /**
   * Maximum rows to render — defaults to 20. The Home feed is a SNAPSHOT of the
   * latest activity, not a scrollable archive: it shows the newest 20 events and
   * the "ראה הכל ‹" link drills to the full, paginated "פעילות" tab. (The read
   * route still returns up to 50; we slice to `limit`.)
   */
  limit?: number;
  className?: string;
  /**
   * When provided, renders a "ראה הכל ‹" footer link that switches to the
   * "פעילות" (Activity) tab — the full, paginated, filterable event browser.
   * Omitted (Home not wired) → no link.
   */
  onSeeAll?: () => void;
}

/* --------------------------------------------------------------------------
 * Constants
 * -------------------------------------------------------------------------- */

// An event is "recent" (drives the GREEN listening badge) when it landed within
// this window. Matches the mockup footer ("אין אירועים ב-15 הדק׳ האחרונות").
const LOOKBACK_MS = 15 * 60_000;

const fetcher = async (url: string): Promise<StoreEventsResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<StoreEventsResponse>;
};

/* --------------------------------------------------------------------------
 * Per-type presentation (token-driven). Each tone uses the status palette
 * (sale=green / refund=red / add_to_cart=blue) — both the glyph-box tint and
 * the glyph/label foreground come from `--status-X-bg` / `--status-X-fg`, which
 * the contrast guard pins to AA on the Card surface in both themes.
 * -------------------------------------------------------------------------- */

interface TypePresentation {
  label: string; // Hebrew type label
  Icon: typeof ShoppingBag;
  glyphBox: string; // bg tint class
  fg: string; // glyph + label foreground class
}

const TYPE_PRESENTATION: Record<StoreEventRow['type'], TypePresentation> = {
  sale: {
    label: 'מכירה',
    Icon: ShoppingBag,
    glyphBox: 'bg-status-greenBg',
    fg: 'text-status-greenFg',
  },
  refund: {
    label: 'החזר',
    Icon: Undo2,
    glyphBox: 'bg-status-redBg',
    fg: 'text-status-redFg',
  },
  add_to_cart: {
    label: 'הוספה לעגלה',
    Icon: ShoppingCart,
    glyphBox: 'bg-status-blueBg',
    fg: 'text-status-blueFg',
  },
};

/* --------------------------------------------------------------------------
 * Hebrew relative-time. `now` defaults to Date.now() (overridable for tests).
 * -------------------------------------------------------------------------- */

function relativeHebrew(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const dMs = now - new Date(iso).getTime();
  if (!Number.isFinite(dMs)) return '—';
  if (dMs < 5_000) return 'עכשיו';
  const dMin = Math.floor(dMs / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `לפני ${dMin}ד׳`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `לפני ${dHr}ש׳`;
  const dDay = Math.floor(dHr / 24);
  return `לפני ${dDay} ימים`;
}

/** Map an internal store_id to its display name (falls back to the raw id). */
function storeDisplayName(storeId: string): string {
  return STORE_ID_TO_NAME[storeId as StoreId] ?? storeId;
}

/** Reverse of STORE_ID_TO_NAME — display name → internal store_id. */
const NAME_TO_STORE_ID: Record<string, StoreId> = Object.fromEntries(
  (Object.entries(STORE_ID_TO_NAME) as [StoreId, string][]).map(([id, name]) => [name, id]),
);

/**
 * Resolve the Home filter value to the internal `store_id` the
 * `/api/store-events` route queries. The Home filter passes a display NAME
 * ("Zol Plus" / "360usmile") but `store_events.store_id` holds the id
 * ("zolplus" / "usmile360") — without this, filtering to any store whose name
 * ≠ id returned an empty feed. Accepts an id passed directly too.
 */
function resolveStoreId(store: string): string {
  if (store in STORE_ID_TO_NAME) return store; // already an id
  return NAME_TO_STORE_ID[store] ?? store; // a display name → id, else as-is
}

/* --------------------------------------------------------------------------
 * LIVE-badge state.
 * -------------------------------------------------------------------------- */

type LiveState = 'listening' | 'idle' | 'disconnected';

function deriveLiveState(
  data: StoreEventsResponse | undefined,
  error: unknown,
): LiveState {
  if (error) return 'disconnected';
  if (!data) return 'idle'; // first load, no error yet → calm idle
  const { lastReceivedAt, serverNow } = data;
  if (!lastReceivedAt) return 'idle';
  const ageMs = Date.parse(serverNow) - Date.parse(lastReceivedAt);
  if (Number.isFinite(ageMs) && ageMs <= LOOKBACK_MS) return 'listening';
  return 'idle';
}

/* --------------------------------------------------------------------------
 * LIVE badge
 * -------------------------------------------------------------------------- */

function LiveBadge({
  state,
  lastReceivedAt,
  serverNow,
  allowMotion,
}: {
  state: LiveState;
  lastReceivedAt: string | null;
  serverNow: string;
  allowMotion: boolean;
}) {
  // The relative-time math uses the SERVER clock (serverNow) as "now" so the
  // badge is immune to browser-clock skew.
  const serverNowMs = Date.parse(serverNow);
  const since = lastReceivedAt ? relativeHebrew(lastReceivedAt, serverNowMs) : null;

  // Tone class per state — token-driven foreground + tint background.
  const tone =
    state === 'listening'
      ? 'text-status-greenFg bg-status-greenBg'
      : state === 'disconnected'
        ? 'text-status-redFg bg-status-redBg'
        : 'text-status-grayFg bg-status-grayBg';

  const label = state === 'listening' ? 'LIVE' : state === 'disconnected' ? 'נותק' : 'מאזין';

  return (
    <span
      data-testid="live-badge"
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wide',
        tone,
      )}
    >
      <span
        className={cn('live-dot', state === 'listening' && allowMotion && 'live-dot--ping')}
        aria-hidden
      />
      {label}
      {state === 'listening' && since && (
        <span className="font-semibold opacity-80">
          {'· '}
          <bdi dir="rtl">{since}</bdi>
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Event row
 * -------------------------------------------------------------------------- */

function EventRow({
  ev,
  serverNowMs,
  fresh,
  allowMotion,
}: {
  ev: StoreEventRow;
  serverNowMs: number;
  fresh: boolean;
  allowMotion: boolean;
}) {
  const pres = TYPE_PRESENTATION[ev.type] ?? TYPE_PRESENTATION.sale;
  const { Icon } = pres;
  const display = storeDisplayName(ev.store_id);
  const showMoney = ev.type !== 'add_to_cart' && ev.amount_cad !== null;

  return (
    <div
      data-testid="store-event-row"
      className={cn(
        'px-5 py-2.5 flex items-center gap-3 border-b border-glass-edge/60 last:border-b-0',
        // Slide-in only when motion is allowed (the global CSS sweep also
        // neutralises it, but gating the class means a reduced-motion session
        // never queues the animation at all).
        fresh && allowMotion && 'animate-fade-in-up',
      )}
    >
      <span
        className={cn('grid place-items-center w-9 h-9 rounded-xl shrink-0', pres.glyphBox, pres.fg)}
        aria-hidden
      >
        <Icon size={17} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={cn('font-extrabold text-[13.5px]', pres.fg)}>{pres.label}</span>
          {showMoney && (
            <Money
              value={ev.amount_cad}
              decimals={2}
              className={cn('font-extrabold text-[13.5px]', pres.fg)}
            />
          )}
        </div>
        {ev.product_title && (
          <span className="block mt-0.5 text-[12.5px] text-ink-secondary truncate">
            {ev.product_title}
          </span>
        )}
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold text-[10.5px] bg-glass-2 text-ink-secondary"
            data-testid="store-chip"
          >
            <span
              className="w-[7px] h-[7px] rounded-full"
              style={{ background: storeColor(display) }}
              aria-hidden
            />
            <bdi dir="ltr">{display}</bdi>
          </span>
          {ev.type !== 'refund' && <SourceBadge source={ev.source} />}
        </div>
      </div>

      <span className="self-start text-[11px] text-ink-subtle tabular-nums whitespace-nowrap shrink-0">
        <bdi dir="rtl">{relativeHebrew(ev.received_at, serverNowMs)}</bdi>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function ActivityFeed({ store, limit = 20, className, onSeeAll }: ActivityFeedProps) {
  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (store && store !== 'All') sp.set('store', resolveStoreId(store));
    const s = sp.toString();
    return s ? `?${s}` : '';
  }, [store]);

  // refreshInterval: 12s — the feed must read as real-time vs the dashboard's
  // ~10-min cadence. The /api/store-events route is no-store (force-dynamic),
  // so each poll reflects the newest events; SWR's dedupe keeps it cheap.
  const { data, error } = useSWR<StoreEventsResponse>(`/api/store-events${params}`, fetcher, {
    refreshInterval: 12_000,
    revalidateOnFocus: true,
  });

  const reducedMotion = useReducedMotion();
  const allowMotion = !reducedMotion;

  const liveState = deriveLiveState(data, error);
  const serverNow = data?.serverNow ?? new Date().toISOString();
  const serverNowMs = Date.parse(serverNow);
  const events = (data?.events ?? []).slice(0, limit);

  return (
    <Card className={cn('!p-0 overflow-hidden flex flex-col', className)} data-testid="activity-feed">
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-glass-edge">
        <Heading level="panel" as="h3" className="text-[13px] flex items-center gap-2">
          <Zap size={15} className="text-accent" aria-hidden />
          פעילות בזמן אמת
        </Heading>
        <LiveBadge
          state={liveState}
          lastReceivedAt={data?.lastReceivedAt ?? null}
          serverNow={serverNow}
          allowMotion={allowMotion}
        />
      </div>

      <div className="flex flex-col max-h-[420px] overflow-auto">
        {events.length === 0 ? (
          // Empty / listening state (mockup): pulsing dot + Hebrew copy.
          <div className="px-5 py-8 text-center">
            <span
              className={cn(
                'live-dot mx-auto mb-3 text-status-green',
                allowMotion && liveState !== 'disconnected' && 'live-dot--ping',
              )}
              aria-hidden
            />
            {liveState === 'disconnected' ? (
              <>
                <div className="font-bold text-[13px] text-status-redFg">החיבור נותק</div>
                <div className="mt-1 text-[12px] text-ink-muted">
                  טעינת הפיד נכשלה. ננסה שוב אוטומטית…
                </div>
              </>
            ) : (
              <>
                <div className="font-bold text-[13px] text-ink">מאזין בזמן אמת…</div>
                <div className="mt-1 text-[12px] text-ink-muted">
                  מחובר ל-3 החנויות. אירועים (מכירות, החזרים, הוספות לעגלה) יופיעו כאן ברגע שיקרו.
                </div>
              </>
            )}
          </div>
        ) : (
          events.map((ev, i) => (
            <EventRow
              key={ev.id}
              ev={ev}
              serverNowMs={serverNowMs}
              // Only the newest row gets the slide-in (avoids a re-animate storm
              // when the list shifts). The freshness is purely presentational.
              fresh={i === 0}
              allowMotion={allowMotion}
            />
          ))
        )}
      </div>

      <div className="px-5 py-2.5 text-center text-[11px] text-ink-subtle border-t border-glass-edge">
        מאזין ל-3 חנויות · מתעדכן רגעית
      </div>

      {/* "ראה הכל ‹" — deep-links to the full "פעילות" (Activity) tab. Only
          rendered when Home wired `onSeeAll`. token-only + AA: text-accent on
          the Card surface, ≥44px touch target. */}
      {onSeeAll && (
        <Button
          type="button"
          variant="ghost"
          onClick={onSeeAll}
          data-testid="activity-feed-see-all"
          className={cn(
            'w-full h-auto min-h-[44px] py-2.5 rounded-none flex items-center justify-center gap-1.5',
            'text-[12px] font-bold text-[color:var(--accent-link)] border-t border-glass-edge',
            'hover:bg-glass-2 focus-visible:ring-accent',
          )}
        >
          ראה הכל
          <span aria-hidden>‹</span>
        </Button>
      )}
    </Card>
  );
}

'use client';

/**
 * "פעילות" (Activity) tab — the browseable, paginated view of ALL store events
 * from the last 30 days (sale / refund / add_to_cart), grouped by day.
 *
 * Same data source as the Home real-time <ActivityFeed> (the `store_events`
 * table via /api/store-events), but instead of the live 12s poll it reads the
 * PAGED branch of that route (`?page=…`) with optional `store`, `type` and a
 * `from`/`to` day window. The "ראה הכל" link in the Home feed footer deep-links
 * here.
 *
 * Filters are deliberately COMPACT (fixed-width selects + small type pills) —
 * the operator complained the year/month selects elsewhere spanned the whole
 * screen; this row never does. Store name → internal store_id resolution
 * happens client-side (same as the feed's `resolveStoreId`) because
 * `store_events.store_id` holds the id, not the display name.
 *
 * Token-only: every colour comes from the status / accent / glass / ink tokens
 * (sale=green / refund=red / add_to_cart=blue). No raw hex/rgb/oklch/px. Money
 * renders through the shared <Money> primitive (CAD, overflow-safe, LTR-isolated
 * <bdi>). DB-sourced strings render as escaped React text (no
 * dangerouslySetInnerHTML). Numbers wrap in <bdi dir="ltr"> for RTL isolation.
 */

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Zap,
  ShoppingBag,
  Undo2,
  ShoppingCart,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Heading } from '@/components/ui/Typography';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/Button';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SourceBadge } from '@/components/ui/SourceBadge';
import { StateBlock } from '@/components/ui/StateBlock';
import { cn } from '@/lib/utils';
import { STORE_ID_TO_NAME, type StoreId } from '@/lib/platformsByStore';
import { storeColor, buildStoreBrandColorMap } from '@/lib/storeColors';
import { useStores } from '@/lib/useStores';
import { getTodayInIsraelTz } from '@/lib/dateRange';
import type { StoreEventRow } from '@/lib/webhooks/store';
import type { StoreEventsPagedResponse } from '@/app/api/store-events/route';
import type { DashboardData } from '@/lib/types';

/* --------------------------------------------------------------------------
 * Props
 * -------------------------------------------------------------------------- */

export interface ActivityEventsTabProps {
  /** Dashboard payload — only `stores` is consumed (the store-picker options). */
  data: DashboardData;
  /** Global store filter (display NAME or 'All'). Seeds the tab's store filter. */
  globalStore?: string;
}

/* --------------------------------------------------------------------------
 * Constants
 * -------------------------------------------------------------------------- */

const PAGE_SIZE = 40;
const WINDOW_DAYS = 30;

type TypeFilter = 'all' | StoreEventRow['type'];

const fetcher = async (url: string): Promise<StoreEventsPagedResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<StoreEventsPagedResponse>;
};

/* --------------------------------------------------------------------------
 * Per-type presentation (token-driven). Mirrors the Home <ActivityFeed> tones:
 * sale=green / refund=red / add_to_cart=blue — glyph-box tint + glyph/label
 * foreground both come from the status tokens (AA-pinned on the Card surface in
 * both themes by the contrast guard).
 * -------------------------------------------------------------------------- */

interface TypePresentation {
  label: string;
  Icon: typeof ShoppingBag;
  glyphBox: string;
  fg: string;
}

const TYPE_PRESENTATION: Record<StoreEventRow['type'], TypePresentation> = {
  sale: { label: 'מכירה', Icon: ShoppingBag, glyphBox: 'bg-status-greenBg', fg: 'text-status-greenFg' },
  refund: { label: 'החזר', Icon: Undo2, glyphBox: 'bg-status-redBg', fg: 'text-status-redFg' },
  add_to_cart: { label: 'הוספה לעגלה', Icon: ShoppingCart, glyphBox: 'bg-status-blueBg', fg: 'text-status-blueFg' },
};

/** Type pills, left→right as in the mockup: הכל / מכירות / החזרים / עגלה. */
const TYPE_PILLS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'sale', label: 'מכירות' },
  { key: 'refund', label: 'החזרים' },
  { key: 'add_to_cart', label: 'עגלה' },
];

/* --------------------------------------------------------------------------
 * Store name ↔ id helpers (same contract as ActivityFeed.resolveStoreId).
 * -------------------------------------------------------------------------- */

const NAME_TO_STORE_ID: Record<string, StoreId> = Object.fromEntries(
  (Object.entries(STORE_ID_TO_NAME) as [StoreId, string][]).map(([id, name]) => [name, id]),
);

/** Resolve a display NAME (or 'All') to the internal store_id the route filters. */
function resolveStoreId(store: string): string {
  if (store in STORE_ID_TO_NAME) return store; // already an id
  return NAME_TO_STORE_ID[store] ?? store; // a display name → id, else as-is
}

/** Map an internal store_id to its display name (falls back to the raw id). */
function storeDisplayName(storeId: string): string {
  return STORE_ID_TO_NAME[storeId as StoreId] ?? storeId;
}

/* --------------------------------------------------------------------------
 * Day helpers — bucket rows by IL calendar day + format labels.
 * -------------------------------------------------------------------------- */

/** ISO calendar day (YYYY-MM-DD) of a timestamp in Israel time. */
function ilDay(iso: string): string {
  return getTodayInIsraelTz(iso);
}

/** ISO date `nDays` before `dateIso` (both YYYY-MM-DD). */
function isoDaysBefore(dateIso: string, nDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - nDays);
  return d.toISOString().slice(0, 10);
}

const HE_MONTHS = [
  'בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני',
  'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר',
];

/** Human day-group header, e.g. "היום · 1 ביוני" / "אתמול · 31 במאי" / "30 במאי". */
function dayHeaderLabel(dayIso: string, todayIso: string): string {
  const yesterdayIso = isoDaysBefore(todayIso, 1);
  const [, m, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  const dayPart = `${d} ${HE_MONTHS[m - 1] ?? ''}`.trim();
  if (dayIso === todayIso) return `היום · ${dayPart}`;
  if (dayIso === yesterdayIso) return `אתמול · ${dayPart}`;
  return dayPart;
}

/** Short option label for the day <select>, e.g. "1/6/2026". */
function dayOptionLabel(dayIso: string, todayIso: string): string {
  const yesterdayIso = isoDaysBefore(todayIso, 1);
  if (dayIso === todayIso) return 'היום';
  if (dayIso === yesterdayIso) return 'אתמול';
  const [y, m, d] = dayIso.split('-').map((x) => parseInt(x, 10));
  return `${d}/${m}/${y}`;
}

/** HH:MM in Israel time for the row's received_at. */
function ilTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/* --------------------------------------------------------------------------
 * Event row
 * -------------------------------------------------------------------------- */

function EventRow({
  ev,
  brandColorByKey,
}: {
  ev: StoreEventRow;
  /** storeId/storeName → brand_color token (Self-serve stores Phase 6a). */
  brandColorByKey: Record<string, string>;
}) {
  const pres = TYPE_PRESENTATION[ev.type] ?? TYPE_PRESENTATION.sale;
  const { Icon } = pres;
  const display = storeDisplayName(ev.store_id);
  // Prefer the operator-chosen brand_color (keyed by raw store_id); known 3
  // backfill to their canonical token → byte-identical.
  const brandColor = brandColorByKey[ev.store_id] ?? brandColorByKey[display];
  const showMoney = ev.type !== 'add_to_cart' && ev.amount_cad !== null;

  return (
    <div
      data-testid="activity-event-row"
      className="px-4 sm:px-5 py-2.5 flex items-center gap-3 border-b border-glass-edge/60 last:border-b-0"
    >
      <span
        className={cn('grid place-items-center w-8 h-8 rounded-lg shrink-0', pres.glyphBox, pres.fg)}
        aria-hidden
      >
        <Icon size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={cn('font-extrabold text-[13px]', pres.fg)}>{pres.label}</span>
          {showMoney && (
            <Money value={ev.amount_cad} decimals={2} className={cn('font-extrabold text-[13px]', pres.fg)} />
          )}
        </div>
        {ev.product_title && (
          <span className="block mt-0.5 text-[12px] text-ink-secondary truncate">{ev.product_title}</span>
        )}
      </div>

      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold text-[10.5px] bg-glass-2 text-ink-secondary shrink-0"
        data-testid="activity-store-chip"
      >
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: storeColor(display, 0, brandColor) }} aria-hidden />
        <bdi dir="ltr">{display}</bdi>
      </span>
      {ev.type !== 'refund' && (
        <SourceBadge
          source={ev.source}
          firstTouchSource={ev.first_touch_source}
          className="shrink-0"
        />
      )}

      <span className="text-[11px] text-ink-subtle tabular-nums whitespace-nowrap shrink-0">
        <bdi dir="ltr">{ilTime(ev.received_at)}</bdi>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function ActivityEventsTab({ data, globalStore }: ActivityEventsTabProps) {
  const today = useMemo(() => getTodayInIsraelTz(), []);

  // Self-serve stores Phase 6a — resolve each store chip's dot through its
  // operator-chosen brand_color. useStores() falls back to the hardcoded 3
  // (whose backfilled brand_color === the canonical token), so the 3 known
  // stores' chips stay byte-identical; a 4th store uses its chosen color.
  const { stores: storeList } = useStores();
  const brandColorByKey = useMemo(
    () => buildStoreBrandColorMap(storeList),
    [storeList],
  );

  // Store filter — seeded from the global store filter (display NAME or 'All').
  const [storeFilter, setStoreFilter] = useState<string>(globalStore ?? 'All');
  // Day filter — '' = all days in the 30-day window; otherwise an ISO date.
  const [dayFilter, setDayFilter] = useState<string>('');
  // Type filter — 'all' = no filter.
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // 1-based page.
  const [page, setPage] = useState<number>(1);

  // Reset to page 1 whenever a filter changes (a stale page can land out of
  // range for the new filtered set).
  const resetPage = () => setPage(1);

  // Recent-day options for the day <select> (today back through the window).
  const dayOptions = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) out.push(isoDaysBefore(today, i));
    return out;
  }, [today]);

  // Build the /api/store-events query (the SWR key).
  const swrKey = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('pageSize', String(PAGE_SIZE));
    if (storeFilter && storeFilter !== 'All') sp.set('store', resolveStoreId(storeFilter));
    if (typeFilter !== 'all') sp.set('type', typeFilter);
    if (dayFilter) {
      // A specific day → from == to == that day.
      sp.set('from', dayFilter);
      sp.set('to', dayFilter);
    } else {
      // Default 30-day window.
      sp.set('from', isoDaysBefore(today, WINDOW_DAYS));
      sp.set('to', today);
    }
    return `/api/store-events?${sp.toString()}`;
  }, [page, storeFilter, typeFilter, dayFilter, today]);

  const { data: resp, error } = useSWR<StoreEventsPagedResponse>(swrKey, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  // Wrap in useMemo so the array identity is stable across renders (a fresh
  // `resp?.events ?? []` literal would change every render and churn the
  // grouping memo below).
  const events = useMemo(() => resp?.events ?? [], [resp?.events]);
  const total = resp?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isLoading = !resp && !error;

  // Group rows by IL calendar day, preserving the newest-first order the API
  // already returns (received_at DESC). A Map keeps insertion order.
  const groups = useMemo(() => {
    const map = new Map<string, StoreEventRow[]>();
    for (const ev of events) {
      const day = ilDay(ev.received_at);
      const bucket = map.get(day);
      if (bucket) bucket.push(ev);
      else map.set(day, [ev]);
    }
    return Array.from(map.entries());
  }, [events]);

  const onPrev = () => setPage((p) => Math.max(1, p - 1));
  const onNext = () => setPage((p) => Math.min(totalPages, p + 1));

  return (
    <Card className="!p-0 overflow-hidden flex flex-col animate-fade-in-up" data-testid="activity-events-tab">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-2.5 border-b border-glass-edge">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-accent-bg text-accent shrink-0" aria-hidden>
          <Zap size={15} />
        </span>
        <div className="min-w-0">
          <Heading level="panel" as="h2" className="text-[14px]">
            פעילות
          </Heading>
          <div className="text-[10.5px] text-ink-muted">כל האירועים · 30 הימים האחרונים</div>
        </div>
      </div>

      {/* COMPACT filters row — fixed-width selects + small type pills, never
          full-width (the operator complaint about the year/month selects). */}
      <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2.5 sm:gap-3 border-b border-glass-edge">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-muted">חנות</span>
          {/* w-auto + a sensible min keeps the select compact, not full-width. */}
          <div className="w-[150px]">
            <NativeSelect
              data-testid="activity-store-filter"
              value={storeFilter}
              onChange={(e) => {
                setStoreFilter(e.target.value);
                resetPage();
              }}
              className="!h-9 text-[12.5px] font-semibold"
              aria-label="סינון לפי חנות"
            >
              <option value="All">כל החנויות</option>
              {data.stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </div>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-muted">יום</span>
          <div className="w-[150px]">
            <NativeSelect
              data-testid="activity-day-filter"
              value={dayFilter}
              onChange={(e) => {
                setDayFilter(e.target.value);
                resetPage();
              }}
              className="!h-9 text-[12.5px] font-semibold"
              aria-label="סינון לפי יום"
            >
              <option value="">כל הימים</option>
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {dayOptionLabel(d, today)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </label>

        {/* Type pills — Horizon toggle-chip recipe on the shared `bg-pill-track`
            rail (active = brand pill `bg-pill-thumb text-pill-inkOn`, AA both
            themes; idle = `text-pill-ink` → ink-up on hover). Touch target ≥44px
            (these are mobile-tapped). Pushed to the row's end (start in RTL).
            Stays a <Button> set (not a SegmentedControl) so `aria-pressed`
            multi-toggle semantics + each label's role="button" name lookup are
            preserved for the existing DOM tests. */}
        <div
          className="flex flex-wrap gap-1 ms-auto rounded-full bg-pill-track p-1"
          role="group"
          aria-label="סינון לפי סוג אירוע"
        >
          {TYPE_PILLS.map((pill) => {
            const active = typeFilter === pill.key;
            return (
              <Button
                key={pill.key}
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => {
                  setTypeFilter(pill.key);
                  resetPage();
                }}
                className={cn(
                  'h-auto rounded-full px-3.5 py-2 text-[11px] font-bold min-h-[44px]',
                  'transition-colors duration-fast ease-out',
                  active
                    ? 'bg-pill-thumb text-pill-inkOn shadow-soft hover:bg-pill-thumb'
                    : 'bg-transparent text-pill-ink hover:bg-transparent hover:text-ink',
                )}
              >
                {pill.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Body — grouped rows / loading / empty / error */}
      <div className="flex flex-col min-h-[200px]">
        {error ? (
          <div data-testid="activity-error" className="px-5 py-12 text-center">
            <div className="font-bold text-[13px] text-status-redFg">טעינת האירועים נכשלה</div>
            <div className="mt-1 text-[12px] text-ink-muted">ננסה שוב אוטומטית…</div>
          </div>
        ) : isLoading ? (
          <div data-testid="activity-loading" className="px-5 py-4">
            <StateBlock
              mode="skeleton"
              shape="table"
              rows={6}
              message="טוען אירועים…"
            />
          </div>
        ) : events.length === 0 ? (
          <div data-testid="activity-empty" className="px-5 py-12 text-center">
            <span className="grid place-items-center w-10 h-10 mx-auto mb-3 rounded-xl bg-pill-track text-ink-muted" aria-hidden>
              <Zap size={18} />
            </span>
            <div className="font-bold text-[13px] text-ink">אין אירועים בטווח/בפילטר שנבחר</div>
            <div className="mt-1 text-[12px] text-ink-muted">נסה לשנות את החנות, היום או סוג האירוע.</div>
          </div>
        ) : (
          groups.map(([day, rows]) => (
            <div key={day} className="flex flex-col">
              <div
                data-testid="activity-day-header"
                className="sticky top-0 z-10 px-4 sm:px-5 py-2 text-[11px] font-extrabold text-ink-muted bg-glass-1 border-b border-glass-edge"
              >
                {dayHeaderLabel(day, today)}
              </div>
              {rows.map((ev) => (
                <EventRow key={ev.id} ev={ev} brandColorByKey={brandColorByKey} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="px-4 sm:px-5 py-3 flex items-center justify-center gap-3 border-t border-glass-edge">
        {/* Prev — points toward inline-start (visually RIGHT in this RTL UI):
            "הקודם" goes BACK, and inline-start sits on the right under dir=rtl,
            so the chevron must point right → lucide ChevronRight. */}
        <Button
          type="button"
          variant="secondary"
          data-testid="activity-prev"
          disabled={page <= 1}
          onClick={onPrev}
          className="h-auto gap-1 px-3.5 py-2 text-[12px] font-bold min-h-[36px]"
        >
          <ChevronRight size={15} aria-hidden />
          הקודם
        </Button>
        <span data-testid="activity-page-info" className="text-[12px] text-ink-muted tabular-nums">
          עמוד <bdi dir="ltr">{page}</bdi> מתוך <bdi dir="ltr">{totalPages}</bdi>
        </span>
        {/* Next — points toward inline-end (visually LEFT in this RTL UI):
            "הבא" goes FORWARD, and inline-end sits on the left under dir=rtl, so
            the chevron must point left → lucide ChevronLeft. */}
        <Button
          type="button"
          variant="secondary"
          data-testid="activity-next"
          disabled={page >= totalPages}
          onClick={onNext}
          className="h-auto gap-1 px-3.5 py-2 text-[12px] font-bold min-h-[36px]"
        >
          הבא
          <ChevronLeft size={15} aria-hidden />
        </Button>
      </div>
    </Card>
  );
}

'use client';

/**
 * Task 3.1 — <ActivityFeed> Home consumer.
 *
 * Extracts the live "recent activity" stream from `<StatusEventsFeed>`
 * (the operator console's server-rendered panel) into a CLIENT component
 * that fetches via SWR so the Home tab can re-poll on store / platform
 * filter changes without a full reload.
 *
 * Why a client SWR consumer and not the same server component?
 *   The Home tab is a client island (filter state, drill handlers, view
 *   transitions). Pulling a server component into that tree means the
 *   shell has to re-mount on every filter change just to re-fetch the
 *   feed. The SWR path coalesces all open tabs into one upstream call
 *   via the cached /api/home/activity-events route (60s revalidate).
 *
 * Route history: originally Wave 3 wired this to /api/operator/status-events.
 * That path is gated by OPERATOR_SECRET middleware → on deployments with
 * the secret set, Home (no operator auth) got a 404 and surfaced "טעינת
 * פעילות אחרונה נכשלה." The public twin /api/home/activity-events reads
 * from the same fetchStatusEvents source under the rest-of-dashboard
 * URL-obscurity trust model.
 *
 * Filter contract (per [[home-visual-rules]]):
 *   • When `store` is 'All' / undefined, every event shows.
 *   • When `store` is a specific store id, only events for that store
 *     are surfaced ("affecting current scope" — the route filters server-
 *     side, this primitive trusts the slice it gets).
 *   • Same shape for `platform` — 'all' or a specific paid-platform key.
 *
 * Composition: thin presentational shell using <Card>. Each feed row
 * mirrors the mockup's `.feed-item` structure (28px icon · text · time).
 * Icons are platform-tinted via <PlatformBadge>; non-platform kinds
 * (warning / shopify) get a dedicated icon-tone.
 *
 * Visual ref: mockup-04-final.html lines 507-516.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Sparkles, Pause, Play, Archive } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { FreshnessBadge } from '@/components/ui/FreshnessBadge';
import { Heading } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import type { StatusEventRow } from '@/lib/operator/registriesReaders';
import type { StatusEventsResponse } from '@/app/api/operator/status-events/route';

/* --------------------------------------------------------------------------
 * Props
 * -------------------------------------------------------------------------- */

export interface ActivityFeedProps {
  /** Optional store filter — pass 'All' or undefined to show every store. */
  store?: string;
  /** Optional platform filter — 'all' / 'meta' / 'google' / 'tiktok'. */
  platform?: 'all' | 'meta' | 'google' | 'tiktok';
  /** Maximum rows to render — defaults to 10 (the mockup carries 5; we
   *  scroll past 10 with a max-height to keep the panel calm). */
  limit?: number;
  className?: string;
}

/* --------------------------------------------------------------------------
 * Fetcher — SWR adapter for /api/home/activity-events.
 * -------------------------------------------------------------------------- */

const fetcher = async (url: string): Promise<StatusEventsResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<StatusEventsResponse>;
};

/* --------------------------------------------------------------------------
 * Hebrew-localised relative time. Sub-minute resolution rounded to "כרגע"
 * (matches the operator console's relativeHebrew helper — kept private
 * here so the panel can drift in copy without touching the server side).
 * -------------------------------------------------------------------------- */

function relativeHebrew(iso: string, now: number = Date.now()): string {
  const dMs = now - new Date(iso).getTime();
  if (!Number.isFinite(dMs)) return '—';
  const dMin = Math.floor(dMs / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `${dMin}דק׳`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `${dHr}שע׳`;
  const dDay = Math.floor(dHr / 24);
  return `${dDay} ימים`;
}

/* --------------------------------------------------------------------------
 * Icon tile per change_kind. Each tile is a 28×28 rounded glass badge
 * with a platform/kind-tinted glow. Matches mockup `.fi-icon` rules.
 * -------------------------------------------------------------------------- */

function ChangeIcon({
  kind,
  platform,
}: {
  kind: string;
  platform: string;
}) {
  // Platform-tinted backgrounds map to the `text-chart-*` token family the
  // PlatformBadge consumes — kept inline so the per-platform glow uses the
  // identical hue as the rest of the dashboard.
  const platLower = platform.toLowerCase();
  // Special kinds short-circuit the platform tint:
  if (kind === 'first_seen') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-accent/15 text-accent shrink-0"
        aria-hidden
      >
        <Sparkles size={13} />
      </span>
    );
  }
  if (kind === 'paused') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-status-warningBg text-status-warning shrink-0"
        aria-hidden
      >
        <Pause size={13} />
      </span>
    );
  }
  if (kind === 'enabled') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-status-greenBg text-status-green shrink-0"
        aria-hidden
      >
        <Play size={13} />
      </span>
    );
  }
  if (kind === 'archived' || kind === 'removed') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-glass-2 text-ink-secondary shrink-0"
        aria-hidden
      >
        <Archive size={13} />
      </span>
    );
  }
  // Default — platform-tinted letter badge so a generic status event still
  // carries the platform identity. Matches mockup `.fi-meta`/`.fi-google`/
  // `.fi-tiktok` style (single letter inside a tinted square).
  if (platLower === 'meta' || platLower === 'fb' || platLower === 'facebook') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-chart-meta/20 text-chart-meta font-bold text-[11px] shrink-0"
        style={{ boxShadow: '0 0 8px -2px currentColor' }}
        aria-hidden
      >
        M
      </span>
    );
  }
  if (platLower === 'google' || platLower === 'ga') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-chart-google/20 text-chart-google font-bold text-[11px] shrink-0"
        style={{ boxShadow: '0 0 8px -2px currentColor' }}
        aria-hidden
      >
        G
      </span>
    );
  }
  if (platLower === 'tiktok' || platLower === 'tt') {
    return (
      <span
        className="grid place-items-center w-7 h-7 rounded-lg bg-chart-tiktok/20 text-chart-tiktok font-bold text-[11px] shrink-0"
        style={{ boxShadow: '0 0 8px -2px currentColor' }}
        aria-hidden
      >
        T
      </span>
    );
  }
  // Unknown platform → neutral warning tile.
  return (
    <span
      className="grid place-items-center w-7 h-7 rounded-lg bg-status-warningBg text-status-warning shrink-0"
      aria-hidden
    >
      <AlertTriangle size={13} />
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function ActivityFeed({
  store,
  platform = 'all',
  limit = 10,
  className,
}: ActivityFeedProps) {
  // Build the API key from the active scope. Empty-string skips a
  // duplicate "no filter" param so cache keys stay deterministic across
  // /All/all and undefined permutations.
  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (store && store !== 'All') sp.set('store', store);
    if (platform && platform !== 'all') sp.set('platform', platform);
    const s = sp.toString();
    return s ? `?${s}` : '';
  }, [store, platform]);

  // refreshInterval: 15s — operator-reported (2026-05-31) that the feed
  // felt frozen on the Home tab. The route is ISR-cached (revalidate=60s)
  // so a 15s poll is effectively cheap: most polls hit the SWR dedupe
  // (`dedupingInterval: 30_000`) or the CDN, and only every ~4th poll
  // round-trips Supabase. Trade-off: stale events surface ≤15s instead of
  // ≤60s, at zero meaningful upstream cost.
  //
  // Endpoint: /api/home/activity-events — public sibling of /api/operator/
  // status-events that bypasses the OPERATOR_SECRET middleware gate so the
  // feed renders on Home for non-operator sessions.
  const { data, error } = useSWR<StatusEventsResponse>(
    `/api/home/activity-events${params}`,
    fetcher,
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
    },
  );

  const events: StatusEventRow[] = data?.events ?? [];
  const visible = events.slice(0, limit);
  const updatedAt = data?.lastUpdated ?? null;

  return (
    <Card
      className={cn('!p-0 overflow-hidden flex flex-col', className)}
      data-testid="activity-feed"
    >
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-glass-edge">
        <Heading level="panel" as="h3" className="text-[13px] text-ink-secondary">
          פעילות אחרונה
        </Heading>
        <FreshnessBadge updatedAt={updatedAt} />
      </div>

      <div className="flex flex-col">
        {error && (
          <div className="px-5 py-6 text-center text-xs text-status-red">
            טעינת פעילות אחרונה נכשלה.
          </div>
        )}

        {!error && data?.error && (
          <div className="px-5 py-6 text-center text-xs text-status-warning">
            {data.error}
          </div>
        )}

        {!error && !data?.error && visible.length === 0 && (
          <div className="px-5 py-6 text-center text-xs text-ink-muted">
            {data
              ? 'אין אירועי סטטוס בטווח הנבחר.'
              : 'טוען אירועים…'}
          </div>
        )}

        {visible.map((e) => (
          <div
            key={e.id}
            className="px-5 py-2.5 grid grid-cols-[28px_1fr_auto] gap-2.5 items-center border-b border-glass-edge/60 last:border-b-0"
            data-testid="activity-feed-item"
          >
            <ChangeIcon kind={e.change_kind} platform={e.platform} />
            <div className="min-w-0 text-[12.5px] leading-tight">
              <bdi dir="ltr" className="font-semibold text-ink truncate block">
                {e.entity_id}
              </bdi>
              <div className="text-[11px] text-ink-muted mt-0.5 truncate">
                <bdi dir="ltr">{e.store_id}</bdi>
                {' · '}
                <bdi dir="ltr">{e.platform}</bdi>
                {' · '}
                {e.from_status ?? '—'} →{' '}
                <strong className="text-ink-secondary">{e.to_status}</strong>
              </div>
            </div>
            <span className="font-mono text-[10.5px] text-ink-subtle tabular-nums shrink-0">
              {relativeHebrew(e.occurred_at)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

'use client';

// dashboard-web/src/components/operator/StatusEventsFeed.tsx
//
// Phase B — last 50 entries from campaign_status_events.
//
// Task 5.2 (UI/UX overhaul, 2026-05-30): converted from an async server
// component to a client component with 15 s SWR polling so all 4 operator
// sub-tabs share a single refresh paradigm.
//
// Reuses /api/operator/status-events (originally created for the Home
// ActivityFeed) — same endpoint, both surfaces get the same data shape.

import useSWR from 'swr';
import { Pause, Play, Sparkles, Archive, AlertCircle, MousePointerClick, Eye } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Heading } from '@/components/ui/Typography';
import type { StatusEventsResponse } from '@/app/api/operator/status-events/route';

const ENDPOINT = '/api/operator/status-events';

async function fetcher(url: string): Promise<StatusEventsResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as StatusEventsResponse;
}

function relativeHebrew(iso: string): string {
  const dMs = Date.now() - new Date(iso).getTime();
  const dMin = Math.floor(dMs / 60_000);
  if (dMin < 1) return 'כרגע';
  if (dMin < 60) return `${dMin} דק׳ לפני`;
  const dHr = Math.floor(dMin / 60);
  if (dHr < 24) return `${dHr} שע׳ לפני`;
  return `${Math.floor(dHr / 24)} ימים לפני`;
}

function kindIcon(kind: string) {
  const size = 14;
  if (kind === 'paused') return <Pause size={size} className="text-status-orange" />;
  if (kind === 'enabled') return <Play size={size} className="text-status-green" />;
  if (kind === 'first_seen') return <Sparkles size={size} className="text-status-blue" />;
  if (kind === 'archived' || kind === 'removed') return <Archive size={size} className="text-ink-secondary" />;
  if (kind === 'effective_only') return <Eye size={size} className="text-ink-secondary" />;
  if (kind === 'delivery_only') return <MousePointerClick size={size} className="text-ink-secondary" />;
  return <AlertCircle size={size} className="text-status-red" />;
}

export function StatusEventsFeed() {
  const { data, isLoading } = useSWR<StatusEventsResponse>(ENDPOINT, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  });

  if (isLoading && !data) {
    return (
      <section className="border border-glass-edge rounded-lg p-4 text-ink-secondary text-sm">
        <Heading level="section" className="font-medium mb-2">שינויי סטטוס אחרונים</Heading>
        <p>טוען…</p>
      </section>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <section className="border border-glass-edge rounded-lg p-4 text-ink-secondary text-sm">
        <Heading level="section" className="font-medium mb-2">שינויי סטטוס אחרונים</Heading>
        <p>אין אירועי סטטוס עדיין. הראשון יופיע תוך 10 דקות מהפעלת ה-orchestrator.</p>
      </section>
    );
  }
  return (
    <section className="border border-glass-edge rounded-lg p-4">
      <Heading level="section" className="font-medium mb-3">
        שינויי סטטוס אחרונים <span className="text-xs text-ink-secondary">(50 אחרונים)</span>
      </Heading>
      <ul className="space-y-1.5 text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-2.5 text-ink">
            <span className="mt-0.5 shrink-0">{kindIcon(e.change_kind)}</span>
            <span className="text-ink-secondary shrink-0 text-xs w-24">{relativeHebrew(e.occurred_at)}</span>
            <span className="shrink-0 text-xs text-ink-secondary">{e.store_id} · {e.platform} · {e.entity_type}</span>
            <span className="shrink-0 text-xs font-mono">{e.entity_id}</span>
            <span className="text-xs text-ink-secondary">
              {e.from_status ?? '—'} → <strong className="text-ink">{e.to_status}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

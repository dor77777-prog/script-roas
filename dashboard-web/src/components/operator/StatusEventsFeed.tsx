// dashboard-web/src/components/operator/StatusEventsFeed.tsx
//
// Phase B — last 50 entries from campaign_status_events. Server
// component (mirrors FreshnessPanel pattern).

import { Pause, Play, Sparkles, Archive, AlertCircle, MousePointerClick, Eye } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { fetchStatusEvents, type StatusEventRow } from '@/lib/operator/registriesReaders';

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
  if (kind === 'first_seen') return <Sparkles size={size} className="text-blue-400" />;
  if (kind === 'archived' || kind === 'removed') return <Archive size={size} className="text-ink-secondary" />;
  if (kind === 'effective_only') return <Eye size={size} className="text-ink-secondary" />;
  if (kind === 'delivery_only') return <MousePointerClick size={size} className="text-ink-secondary" />;
  return <AlertCircle size={size} className="text-status-red" />;
}

export async function StatusEventsFeed() {
  const events: StatusEventRow[] = await fetchStatusEvents(getSupabaseAdmin());
  if (events.length === 0) {
    return (
      <section className="border border-line-subtle rounded-lg p-4 text-ink-secondary text-sm">
        <h3 className="text-base font-medium text-ink-primary mb-2">שינויי סטטוס אחרונים</h3>
        <p>אין אירועי סטטוס עדיין. הראשון יופיע תוך 10 דקות מהפעלת ה-orchestrator.</p>
      </section>
    );
  }
  return (
    <section className="border border-line-subtle rounded-lg p-4">
      <h3 className="text-base font-medium text-ink-primary mb-3">
        שינויי סטטוס אחרונים <span className="text-xs text-ink-secondary">(50 אחרונים)</span>
      </h3>
      <ul className="space-y-1.5 text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-2.5 text-ink-primary">
            <span className="mt-0.5 shrink-0">{kindIcon(e.change_kind)}</span>
            <span className="text-ink-secondary shrink-0 text-xs w-24">{relativeHebrew(e.occurred_at)}</span>
            <span className="shrink-0 text-xs text-ink-secondary">{e.store_id} · {e.platform} · {e.entity_type}</span>
            <span className="shrink-0 text-xs font-mono">{e.entity_id}</span>
            <span className="text-xs text-ink-secondary">
              {e.from_status ?? '—'} → <strong className="text-ink-primary">{e.to_status}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

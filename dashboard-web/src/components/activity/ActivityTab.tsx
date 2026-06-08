'use client';

/**
 * "פעילות" (Activity) area wrapper — hosts a small sub-tab SWITCHER that swaps
 * between the existing live events feed (<ActivityEventsTab>) and the new
 * statistics view (<ActivityStatsTab>, AS-T2).
 *
 *   • "פיד חי"                     → the existing browseable events feed.
 *   • "סטטיסטיקות והתפלגויות"      → the attribution donuts + per-product table.
 *
 * DEFAULT = the live feed, so an operator who never clicks the switcher sees
 * exactly the previous behaviour (no info loss, no regression). The stats view
 * reads the SAME GLOBAL filters (range + store) the rest of the dashboard uses
 * — no separate date picker.
 *
 * The switcher is a tablist (role="tab"/aria-selected) styled in the existing
 * graphic language (underline-active sub-tabs, token-driven, AA both themes,
 * RTL logical classes).
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ActivityEventsTab } from '@/components/activity/ActivityEventsTab';
import { ActivityStatsTab } from '@/components/activity/ActivityStatsTab';
import type { DashboardData, DateRange } from '@/lib/types';

export interface ActivityTabProps {
  /** Dashboard payload — passed through to the events feed (store picker). */
  data: DashboardData;
  /** Global store filter (display NAME or 'All'). */
  globalStore?: string;
  /** Global dashboard date range (filters.range) — keys the stats fetch. */
  range: DateRange;
}

type SubTab = 'feed' | 'stats';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'feed', label: 'פיד חי' },
  { key: 'stats', label: 'סטטיסטיקות והתפלגויות' },
];

export function ActivityTab({ data, globalStore, range }: ActivityTabProps) {
  const [sub, setSub] = useState<SubTab>('feed');

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher — underline-active tablist. */}
      <div
        role="tablist"
        aria-label="תצוגת פעילות"
        className="flex gap-1 border-b border-glass-edge"
      >
        {SUB_TABS.map((t) => {
          const active = sub === t.key;
          return (
            <Button
              key={t.key}
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={active}
              data-testid={`activity-subtab-${t.key}`}
              onClick={() => setSub(t.key)}
              className={cn(
                'h-auto rounded-none px-3.5 py-2.5 text-sm font-semibold border-b-2 -mb-px',
                active
                  ? 'text-ink border-accent'
                  : 'text-ink-muted border-transparent hover:text-ink-secondary',
              )}
            >
              {t.label}
            </Button>
          );
        })}
      </div>

      {sub === 'feed' ? (
        <ActivityEventsTab data={data} globalStore={globalStore} />
      ) : (
        <ActivityStatsTab range={range} globalStore={globalStore} />
      )}
    </div>
  );
}

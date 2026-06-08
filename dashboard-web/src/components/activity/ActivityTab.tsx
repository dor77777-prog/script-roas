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
 * On the STATS sub-tab we surface the shared <Filters> strip (range + store)
 * wired to the GLOBAL setFilters, so the operator can change the date range /
 * store WITHOUT leaving to the Home tab and coming back. Changing it updates
 * filters.range / filters.store dashboard-wide (consistent with every other
 * tab) and the stats fetch re-keys automatically. The LIVE-FEED sub-tab is
 * range-independent (it shows the latest events), so we deliberately do NOT
 * render the range picker above it — adding it there would imply the feed is
 * range-filtered. The store still applies to the feed via the existing
 * globalStore (derived from filters.store).
 *
 * The switcher is a tablist (role="tab"/aria-selected) styled in the existing
 * graphic language (underline-active sub-tabs, token-driven, AA both themes,
 * RTL logical classes).
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Filters } from '@/components/Filters';
import { ActivityEventsTab } from '@/components/activity/ActivityEventsTab';
import { ActivityStatsTab } from '@/components/activity/ActivityStatsTab';
import type { DashboardData, Filters as F } from '@/lib/types';

export interface ActivityTabProps {
  /** Dashboard payload — passed through to the events feed (store picker). */
  data: DashboardData;
  /**
   * GLOBAL dashboard filters (range + store). Drives the stats fetch and the
   * shared <Filters> strip on the stats sub-tab; filters.store is the global
   * store filter (display NAME or 'All') applied to both sub-views.
   */
  filters: F;
  /** Store display names for the shared <Filters> store picker (data.stores). */
  stores: string[];
  /**
   * GLOBAL setFilters — the <Filters> strip writes range/store changes here so
   * they apply dashboard-wide (same wiring as every other tab).
   */
  onChange: (next: F) => void;
}

type SubTab = 'feed' | 'stats';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'feed', label: 'פיד חי' },
  { key: 'stats', label: 'סטטיסטיקות והתפלגויות' },
];

export function ActivityTab({ data, filters, stores, onChange }: ActivityTabProps) {
  const [sub, setSub] = useState<SubTab>('feed');

  // The global store filter applies to BOTH sub-views; the global range keys
  // the stats fetch. Both are read straight off the global filters.
  const globalStore = filters.store;
  const range = filters.range;

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
        <>
          {/* Shared range + store picker — stats sub-tab only. Wired to the
              GLOBAL setFilters so changing it applies dashboard-wide and the
              stats fetch re-keys automatically. NOT shown on the live feed. */}
          <Filters filters={filters} stores={stores} onChange={onChange} />
          <ActivityStatsTab range={range} globalStore={globalStore} />
        </>
      )}
    </div>
  );
}

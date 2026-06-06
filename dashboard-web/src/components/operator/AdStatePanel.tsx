'use client';

// dashboard-web/src/components/operator/AdStatePanel.tsx
//
// Presentational matrix for the ads-off feature (Phase 1).
// Shows a store × platform grid; each applicable cell has a Switch toggle.
// Non-applicable cells (store has no account for that platform) show
// "לא רלוונטי" in muted text — the operator cannot toggle them.
//
// Consumed by: /operator page (wired in a future task).
// State management: lifted — parent owns AdStateMap and onToggle handler.

import type { StoreMetaRow } from '@/lib/postgresReaders';
import {
  applicablePlatforms,
  isAdsEnabled,
  type AdPlatform,
  type AdStateMap,
} from '@/lib/adState';
import { Switch } from '@/components/ui/Switch';
import { Heading } from '@/components/ui/Typography';
import { TableBase } from '@/components/ui/TableBase';

const COLS: { key: AdPlatform; label: string }[] = [
  { key: 'meta', label: 'Meta' },
  { key: 'google', label: 'Google' },
  { key: 'tiktok', label: 'TikTok' },
];

export function AdStatePanel(props: {
  storeMeta: StoreMetaRow[];
  map: AdStateMap;
  tiktokStores: Set<string>;
  onToggle: (storeId: string, platform: AdPlatform, enabled: boolean) => void;
}) {
  const { storeMeta, map, tiktokStores, onToggle } = props;

  return (
    <section className="space-y-3">
      <Heading level="hero">מצב פרסום</Heading>
      <p className="text-ink-secondary text-sm">
        כיבוי/הדלקת פרסום לכל חנות ופלטפורמה. כבוי = לא נמשך מה-API, לא מתריע, ומוצג
        כ&quot;אורגני/כבוי&quot;. (משפיע על התצוגה והפייפליין רק בשלבים הבאים — כרגע זהו מתג
        השליטה בלבד.)
      </p>

      <div className="overflow-x-auto">
        <TableBase>
          <thead className="text-ink-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="text-start p-2">חנות</th>
              {COLS.map((c) => (
                <th key={c.key} className="p-2 text-center">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storeMeta.map((s) => {
              const applicable = new Set(applicablePlatforms(s, tiktokStores));
              return (
                <tr key={s.storeId} className="border-t border-glass-edge">
                  <td className="text-start p-2 font-semibold">{s.storeName}</td>
                  {COLS.map((c) => {
                    if (!applicable.has(c.key)) {
                      return (
                        <td key={c.key} className="p-2 text-center text-ink-subtle text-xs">
                          לא רלוונטי
                        </td>
                      );
                    }
                    const on = isAdsEnabled(map, s.storeId, c.key);
                    return (
                      <td key={c.key} className="p-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Switch
                            checked={on}
                            onCheckedChange={(checked) => onToggle(s.storeId, c.key, checked)}
                            data-testid={`toggle-${s.storeId}-${c.key}`}
                            aria-label={`${s.storeName} ${c.label} ${on ? 'דלוק' : 'כבוי'}`}
                          />
                          <span className="text-xs text-ink-muted w-8 text-start">
                            {on ? 'דלוק' : 'כבוי'}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </TableBase>
      </div>
    </section>
  );
}

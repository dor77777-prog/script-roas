'use client';

// dashboard-web/src/components/operator/AdStatePanel.tsx
//
// Presentational matrix for the ads-off feature (Phase 1).
// Shows a store × platform grid; each applicable cell has a Switch toggle.
// Non-applicable cells (store has no credentials for that platform) show
// "לא מחובר" (not connected) instead of the old "לא רלוונטי" — the latter
// read like a hard limitation, but it just means the platform isn't connected
// yet. Credentials are managed in the "חנויות" tab (Phase 6a credential
// matrix). When `onConnect` is wired the cell renders a "חבר" link that
// switches the operator console to that tab; without it the cell shows a
// static hint pointing the operator there.
//
// Consumed by: /operator page (via AdStateTab).
// State management: lifted — parent owns AdStateMap and onToggle handler.

import type { StoreMetaRow } from '@/lib/postgresReaders';
import {
  applicablePlatforms,
  isAdsEnabled,
  type AdPlatform,
  type AdStateMap,
} from '@/lib/adState';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
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
  // Optional: when provided, an unconnected cell renders a "חבר" link that
  // (in the parent) switches the operator console to the "חנויות" tab where
  // the credential matrix lives. When omitted the cell falls back to a static
  // hint pointing the operator at that tab.
  onConnect?: (storeId: string, platform: AdPlatform) => void;
}) {
  const { storeMeta, map, tiktokStores, onToggle, onConnect } = props;

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
                        <td key={c.key} className="p-2 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-ink-subtle text-xs">לא מחובר</span>
                            {onConnect ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() => onConnect(s.storeId, c.key)}
                                data-testid={`connect-${s.storeId}-${c.key}`}
                                aria-label={`חבר ${c.label} עבור ${s.storeName} (טאב חנויות)`}
                              >
                                חבר
                              </Button>
                            ) : (
                              <span className="text-ink-subtle text-xs">
                                נהל בטאב &quot;חנויות&quot;
                              </span>
                            )}
                          </div>
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

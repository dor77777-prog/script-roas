'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Receipt,
  Plus,
  Trash2,
  X,
  Edit3,
  Check,
  AlertCircle,
  Sparkles,
  Settings as SettingsIcon,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Money } from '@/components/ui/Money';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import { NativeSelect } from '@/components/ui/NativeSelect';
import {
  generateId,
  hasAnyBilling,
  seedBillingIfEmpty,
  shopifyPlanCadForName,
  type CostSource,
  type OneTimeCost,
  type RecurringCost,
} from '@/lib/billing';
import { isHydrated } from '@/lib/cloudSync';
import { FROZEN_USD_TO_CAD } from '@/lib/constants';
import { useBillingRecurring } from '@/lib/hooks/useBillingRecurring';
import { useBillingOneTime } from '@/lib/hooks/useBillingOneTime';
import { useDrawerEsc } from '@/lib/drawerStack';
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle } from '@/components/ui/Sheet';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { BillingCsvImport } from './BillingCsvImport';

type StoreMetaRow = {
  storeId: string;
  storeName: string;
  planDisplayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  updatedAt: string | null;
  /** When the Shopify GraphQL plan-detection call failed (missing scope,
   *  expired token, etc.), the writer persists the reason into the `stores`
   *  table. We surface this so the user understands why auto-detect isn't
   *  populating plans rather than silently showing nothing. */
  lastError?: string | null;
};
type StoreMetaResponse = { rows: StoreMetaRow[]; lastUpdated?: string; error?: string };

const metaFetcher = async (url: string): Promise<StoreMetaResponse> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return { rows: [] };
  return (await r.json()) as StoreMetaResponse;
};

/**
 * Billing settings panel — manage recurring monthly costs (Shopify plan,
 * external apps like Klaviyo, email service) + one-time / overage charges +
 * Shopify Bills CSV import (see ./BillingCsvImport).
 *
 * Storage: cloud-synced via useBillingRecurring + useBillingOneTime hooks
 * (both subscribe to the 'roas-billing-changed' event).
 */

type Props = {
  storeNames: string[];
};

type Tab = 'recurring' | 'onetime' | 'import';

// Exported so the extracted BillingCsvImport sub-component can consume the
// same labels/colors without duplicating the table. RecurringTab/OneTimeTab
// (still in this file) also use them. PnLBreakdown.tsx keeps its own copy
// for Phase 4 (out of ROADMAP scope to refactor; future phase may unify).
export const SOURCE_LABEL: Record<CostSource, string> = {
  'shopify-plan': 'Shopify Plan',
  'shopify-app':  'אפליקציה דרך Shopify',
  'external-app': 'אפליקציה חיצונית',
  email:          'שירות אימייל',
  usage:          'חיוב סף / overage',
  'one-off':      'חד-פעמי',
  other:          'אחר',
};

// Horizon re-skin W6.2 — paired (surface, on-surface) token per source so every
// chip clears WCAG-AA (≥4.5:1) in BOTH themes. The 'one-off' / 'other' entries
// PREVIOUSLY used `bg-ink-muted text-ink-secondary` — a TEXT token painted as a
// background, producing low-contrast gray-on-gray. Retinted to the neutral
// inset pair (`bg-pill-track text-ink`): pill-track is the sunken surface scrim,
// text-ink is primary ink → AA-safe. The other 5 already use proper status
// `*Bg`/`*Fg` paired tokens.
export const SOURCE_COLOR: Record<CostSource, string> = {
  'shopify-plan': 'bg-accent-bg text-accent',
  'shopify-app':  'bg-status-blueBg text-status-blueFg',
  'external-app': 'bg-status-grayBg text-status-grayFg',
  email:          'bg-status-warningBg text-status-warningFg',
  usage:          'bg-status-orangeBg text-status-orangeFg',
  'one-off':      'bg-pill-track text-ink',
  other:          'bg-pill-track text-ink',
};

export function BillingSettings({ storeNames }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('recurring');
  // a11y: ESC-to-close via the shared drawer stack so this modal cooperates
  // with any open drilldown drawers (only the topmost responds to Escape).
  useDrawerEsc(open, () => setOpen(false));
  // Cloud-synced billing state lives in two custom hooks. Both subscribe to
  // the SAME `'roas-billing-changed'` event (cloudSync.ts:58-66 maps both
  // billing keys to one event). The hooks' returned setters write through
  // to localStorage + cloud + event via `writeRecurring` / `writeOneTime`.
  const { recurring, setRecurring: persistRecurring, totalMonthly } = useBillingRecurring();
  const { oneTime, setOneTime: persistOneTime } = useBillingOneTime();

  // Auto-detected Shopify plan per store (read from the `stores` table via
  // /api/store-meta). Only fetched after the panel opens — no point pinging
  // Supabase if the user never opens the settings.
  const { data: meta } = useSWR<StoreMetaResponse>(
    open ? '/api/store-meta' : null,
    metaFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const detectedPlans: StoreMetaRow[] = meta?.rows ?? [];

  // The parent passes data.stores; SWR returns a new array reference on every
  // refetch (60s). Deep-compare via a string key so the effect below doesn't
  // re-register listeners every minute.
  const storeNamesKey = storeNames.join('|');

  // Seed-on-empty branch. The hooks above already handle hydrate + listen +
  // re-read; here we ONLY handle the case where cloud-hydrate completes and
  // the local snapshot is still empty — a genuine first-time user. The seed
  // depends on `storeNames` (a prop), which is why it stays in the shell and
  // not in the generic hook.
  //
  // WR2-02: Seeding is restricted to the FIRST hydrate of the session. If
  // BillingSettings remounts (route change, tab toggle, parent re-render)
  // AFTER hydrate already finished, we do NOT re-seed — by then any partner
  // data was already merged into localStorage by the first hydrate, and the
  // safety-net "re-fetch then seed" approach we previously used had a race:
  // the fetch+seed sequence wasn't atomic, so a partner write landing
  // between our re-fetch and our seed POST would be overwritten by the seed.
  // Restricting seeding to the first hydrate eliminates the re-fetch race
  // entirely (no re-fetch on remount, no seed on remount), while still
  // serving genuine first-time users whose cloud is empty at hydrate time.
  useEffect(() => {
    // Only seed if hydrate has NOT yet completed when this effect runs.
    // When hydrated is already true at mount, the first hydrate's snapshot
    // is the source of truth and any seed would be redundant at best,
    // racy at worst.
    if (isHydrated()) return;

    let cancelled = false;
    const onHydrated = () => {
      if (cancelled) return;
      // At this point the first hydrate just completed. hasAnyBilling()
      // reflects local state AFTER cloudSync's writeLocal merged any
      // cloud values — so local IS the authoritative snapshot of what
      // cloud had at hydrate time. If non-empty, the hooks' own
      // `'roas-billing-changed'` listeners will pick up cloudSync's writes;
      // no extra action needed here. If empty, seed — `writeRecurring` /
      // `writeOneTime` inside `seedBillingIfEmpty` will fire the same event
      // and the hooks will re-read.
      if (hasAnyBilling()) return;
      seedBillingIfEmpty(storeNames);
    };
    window.addEventListener('roas-cloud-hydrated', onHydrated, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('roas-cloud-hydrated', onHydrated);
    };
    // Depending on the string key (not the array ref) avoids re-running on
    // every SWR refetch when the underlying store list hasn't actually changed.
    // storeNames is captured by closure; safe because the key only changes
    // when the list does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeNamesKey]);

  return (
    <>
      <HelpTooltip content="הגדרות עלויות חודשיות">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 sm:gap-2 shrink-0"
        >
          <SettingsIcon size={14} />
          <span>עלויות חודשיות</span>
          <span className="hidden sm:inline text-ink-muted tabular-nums">
            ({recurring.filter(r => r.active).length} פעילות ·{' '}
            <Money value={totalMonthly} prefix="CAD" locale="he-IL" decimals={0} />)
          </span>
        </Button>
      </HelpTooltip>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* TODO(reskin-w7): proper centered Sheet variant — the
            `sm:top-1/2 sm:-translate-y-1/2` translate trick below fakes a
            centered Dialog on desktop. A real centered variant belongs in the
            Sheet primitive (later primitive pass); left as-is here per W6.2 scope. */}
        <SheetContent
          side="bottom"
          dir="rtl"
          aria-labelledby="billing-settings-title"
          hideDefaultClose
          className="h-[92vh] sm:h-[88vh] max-h-[92vh] flex flex-col p-0 sm:mx-auto sm:max-w-3xl rounded-t-2xl sm:rounded-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:inset-x-0"
        >
          <SheetHeader className="flex items-center justify-between gap-3 py-3 sm:px-5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-accent-soft text-accent shrink-0">
                <Receipt size={16} />
              </span>
              <div className="min-w-0">
                <SheetTitle id="billing-settings-title" className="text-sm sm:text-base truncate">
                  עלויות חודשיות
                </SheetTitle>
                <p className="text-fs-2xs sm:text-xs text-ink-muted mt-0.5 truncate">
                  Shopify plan, אפליקציות, שירותים — מתעדכנים ב-P&amp;L האמיתי
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="סגור"
              className="z-20"
            >
              <X size={18} />
            </Button>
          </SheetHeader>

          {/* Tabs — Horizon SegmentedControl (W6.2). Was a hand-rolled <Button>
              row with a divergent active state; now the shared pill-track rail.
              Per-tab count badge embedded in the option label; per-option testId
              preserves stable per-choice hooks. */}
          <nav className="px-4 sm:px-5 py-2 border-b border-glass-edge bg-pill-track/95 [backdrop-filter:var(--blur-glass)]">
            <SegmentedControl
              aria-label="עלויות חודשיות — בחירת לשונית"
              size="sm"
              value={tab}
              onChange={v => setTab(v as Tab)}
              options={(
                [
                  { key: 'recurring' as Tab, label: 'חודשי קבוע', count: recurring.length },
                  { key: 'onetime' as Tab, label: 'חד-פעמיים', count: oneTime.length },
                  { key: 'import' as Tab, label: 'ייבא CSV מ-Shopify', count: 0 },
                ] satisfies Array<{ key: Tab; label: string; count: number }>
              ).map(t => ({
                value: t.key,
                testId: `billing-tab-${t.key}`,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    {t.label}
                    {t.count > 0 && (
                      <span className="inline-block text-fs-2xs tabular-nums opacity-70">
                        ({t.count})
                      </span>
                    )}
                  </span>
                ),
              })) satisfies SegmentedOption[]}
            />
          </nav>

          <SheetBody className="sm:px-5">
            {tab === 'recurring' && (
              <RecurringTab
                items={recurring}
                storeNames={storeNames}
                detectedPlans={detectedPlans}
                onChange={persistRecurring}
              />
            )}
            {tab === 'onetime' && (
              <OneTimeTab
                items={oneTime}
                storeNames={storeNames}
                onChange={persistOneTime}
              />
            )}
            {tab === 'import' && (
              <BillingCsvImport
                storeNames={storeNames}
                currentRecurring={recurring}
                onImported={(newRecurring, newOneTime, destination) => {
                  if (newRecurring.length > 0) persistRecurring([...newRecurring, ...recurring]);
                  if (newOneTime.length > 0) persistOneTime([...newOneTime, ...oneTime]);
                  setTab(destination);
                }}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ============================================================================
// Recurring tab — list of monthly subscriptions
// ============================================================================

function RecurringTab({
  items,
  storeNames,
  detectedPlans,
  onChange,
}: {
  items: RecurringCost[];
  storeNames: string[];
  detectedPlans: StoreMetaRow[];
  onChange: (next: RecurringCost[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  // Detected plans missing from the user's current recurring list. We match by
  // store name + source='shopify-plan' to avoid double-adding after the user
  // already created a row manually or via CSV import.
  const missingDetected = useMemo(() => {
    return detectedPlans.filter(m => {
      if (!m.planDisplayName) return false;
      if (!storeNames.includes(m.storeName)) return false;
      const alreadyHasPlan = items.some(
        r =>
          r.source === 'shopify-plan' &&
          (r.store === m.storeName || r.store === 'All'),
      );
      return !alreadyHasPlan;
    });
  }, [detectedPlans, items, storeNames]);

  // Stores whose plan auto-detect call failed (missing scope, expired token,
  // GraphQL error). We surface these so the user can fix the root cause
  // instead of wondering why auto-detect isn't suggesting anything.
  const planErrorStores = useMemo(() => {
    return detectedPlans.filter(
      m => !!m.lastError && storeNames.includes(m.storeName),
    );
  }, [detectedPlans, storeNames]);

  function addNew() {
    const fresh: RecurringCost = {
      id: generateId(),
      store: storeNames[0] ?? 'All',
      name: '',
      source: 'external-app',
      monthlyCAD: 0,
      active: true,
    };
    onChange([fresh, ...items]);
    setEditing(fresh.id);
  }

  function addDetectedPlan(m: StoreMetaRow) {
    const monthlyCad = shopifyPlanCadForName(m.planDisplayName) ?? 0;
    const row: RecurringCost = {
      id: generateId(),
      store: m.storeName,
      name: m.planDisplayName,
      source: 'shopify-plan',
      monthlyCAD: monthlyCad,
      active: true,
      notes:
        monthlyCad > 0
          ? `Auto-detected מ-Shopify GraphQL · USD→CAD ×${FROZEN_USD_TO_CAD}`
          : `Auto-detected מ-Shopify (תוכנית מותאמת — עדכן את הסכום ידנית)`,
    };
    onChange([row, ...items]);
  }

  function addAllDetected() {
    if (missingDetected.length === 0) return;
    const news: RecurringCost[] = missingDetected.map(m => {
      const monthlyCad = shopifyPlanCadForName(m.planDisplayName) ?? 0;
      return {
        id: generateId(),
        store: m.storeName,
        name: m.planDisplayName,
        source: 'shopify-plan',
        monthlyCAD: monthlyCad,
        active: true,
        notes:
          monthlyCad > 0
            ? `Auto-detected מ-Shopify GraphQL · USD→CAD ×${FROZEN_USD_TO_CAD}`
            : `Auto-detected מ-Shopify (תוכנית מותאמת — עדכן את הסכום ידנית)`,
      };
    });
    onChange([...news, ...items]);
  }

  function update(id: string, patch: Partial<RecurringCost>) {
    onChange(items.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    onChange(items.filter(r => r.id !== id));
  }

  return (
    <div className="space-y-3">
      {planErrorStores.length > 0 && (
        <div className="rounded-lg border border-status-warning bg-status-warningBg p-3">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-status-warningBg text-status-warningFg shrink-0">
              <AlertCircle size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-status-warningFg">
                זיהוי אוטומטי של תוכניות Shopify נכשל
              </div>
              <p className="text-fs-2xs sm:text-xs text-status-warningFg mt-0.5 leading-relaxed">
                הקריאה ל-plan דרך Shopify GraphQL Admin API נכשלה. סיבות
                נפוצות: ה-token לא כולל את ה-scope <code>read_shop</code>,
                ה-token פג, או החנות חסומה. תיקון נדרש בצד ה-token של החנות
                ב-Vercel. עד אז ניתן להוסיף את התוכניות ידנית.
              </p>
              <ul className="mt-2 space-y-1">
                {planErrorStores.map(m => (
                  <li
                    key={m.storeId}
                    className="rounded-md bg-pill-track border border-status-warning px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink shrink-0">
                        {m.storeName}
                      </span>
                      <span className="text-fs-2xs text-ink-muted shrink-0">
                        {m.updatedAt ? `עודכן ${m.updatedAt}` : ''}
                      </span>
                    </div>
                    <div
                      dir="ltr"
                      className="text-fs-2xs text-status-warningFg font-mono mt-1 break-words"
                    >
                      {m.lastError}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      {missingDetected.length > 0 && (
        <div className="rounded-lg border border-accent bg-accent-bg p-3">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-accent-soft text-accent shrink-0">
              <Sparkles size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs sm:text-sm font-semibold text-ink">
                  זיהינו אוטומטית תוכניות Shopify
                </div>
                {missingDetected.length > 1 && (
                  <Button
                    variant="link"
                    onClick={addAllDetected}
                    className="h-auto p-0 text-fs-2xs sm:text-xs font-semibold"
                  >
                    הוסף את כולן ({missingDetected.length})
                  </Button>
                )}
              </div>
              <p className="text-fs-2xs sm:text-xs text-ink-secondary mt-0.5 leading-relaxed">
                שלפנו את שם התוכנית דרך GraphQL ושיערנו את העלות החודשית
                ב-CAD. סכומים מבוססים על מחירון Shopify הציבורי.
              </p>
              <ul className="mt-2 space-y-1">
                {missingDetected.map(m => {
                  const cad = shopifyPlanCadForName(m.planDisplayName);
                  return (
                    <li
                      key={m.storeId}
                      className="flex items-center gap-2 rounded-md bg-pill-track border border-glass-edge px-2.5 py-1.5"
                    >
                      <span className="text-xs text-ink-secondary shrink-0">
                        {m.storeName}
                      </span>
                      <span className="text-xs font-semibold text-ink truncate">
                        {m.planDisplayName}
                      </span>
                      <span className="text-fs-2xs text-ink-muted tabular-nums shrink-0">
                        {cad ? (
                          <>
                            ≈ <Money value={cad} prefix="CAD" locale="he-IL" decimals={0} />/מ
                          </>
                        ) : (
                          'מחיר לא ידוע — הזן ידנית'
                        )}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => addDetectedPlan(m)}
                        className="ms-auto gap-1 text-fs-2xs shrink-0"
                      >
                        <Plus size={11} />
                        הוסף
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed">
          מנויים חודשיים שחוזרים אוטומטית בכל חודש. Shopify plan, אפליקציות
          חיצוניות (Klaviyo וכו&apos;), שירות אימייל. כל שורה פעילה תיכלל ב-P&amp;L.
        </p>
        <Button
          onClick={addNew}
          size="sm"
          className="shrink-0"
        >
          <Plus size={13} />
          הוסף
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-10 text-ink-muted text-sm">
          <Receipt size={28} className="mx-auto mb-2 text-ink-muted" />
          <div>אין מנויים חודשיים. לחץ "הוסף" כדי להתחיל.</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(r => (
            <li
              key={r.id}
              className={cn(
                'rounded-lg border bg-glass-1',
                r.active ? 'border-glass-edge' : 'border-glass-edge/50 opacity-60',
              )}
            >
              {editing === r.id ? (
                <RecurringEditForm
                  item={r}
                  storeNames={storeNames}
                  onSave={patch => {
                    update(r.id, patch);
                    setEditing(null);
                  }}
                  onCancel={(draft) => {
                    // The user pressed Escape / clicked ביטול. If they had
                    // typed a name into the draft but never committed it,
                    // keep the row and persist the partial draft rather than
                    // silently throwing away their typing. Only remove the
                    // row when BOTH the saved item and the draft name are
                    // empty (covers the "addNew then immediately cancel"
                    // case where nothing was typed).
                    const trimmed = draft.name.trim();
                    if (!r.name && !trimmed) {
                      remove(r.id);
                    } else if (!r.name && trimmed) {
                      update(r.id, { name: trimmed });
                    }
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-3 p-3">
                  <HelpTooltip content={r.active ? 'פעיל' : 'מושעה'}>
                    <Switch
                      checked={r.active}
                      onCheckedChange={checked => update(r.id, { active: checked })}
                      aria-label={r.active ? 'פעיל' : 'מושעה'}
                    />
                  </HelpTooltip>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ink">
                        {r.name || '(ללא שם)'}
                      </span>
                      <span
                        className={cn(
                          'inline-block text-fs-2xs font-semibold px-1.5 py-0.5 rounded',
                          SOURCE_COLOR[r.source],
                        )}
                      >
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <span className="text-fs-2xs text-ink-muted">
                        {r.store === 'All' ? 'כל החנויות' : r.store}
                      </span>
                    </div>
                    {r.notes && (
                      <div className="text-fs-2xs text-ink-muted mt-0.5">{r.notes}</div>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    {typeof r.percentOfRevenue === 'number' && r.percentOfRevenue > 0 ? (
                      <>
                        <div className="text-sm font-bold tabular-nums text-ink">
                          {r.percentOfRevenue}%
                        </div>
                        <div className="text-fs-2xs text-ink-muted">מהמחזור</div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-bold tabular-nums text-ink">
                          <Money value={r.monthlyCAD} prefix="CAD" locale="he-IL" decimals={0} />
                        </div>
                        <div className="text-fs-2xs text-ink-muted">/חודש</div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(r.id)}
                      aria-label="ערוך"
                      className="w-8 h-8"
                    >
                      <Edit3 size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(r.id)}
                      aria-label="מחק"
                      className="w-8 h-8 text-ink-muted hover:text-status-redFg hover:bg-status-redBg"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecurringEditForm({
  item,
  storeNames,
  onSave,
  onCancel,
}: {
  item: RecurringCost;
  storeNames: string[];
  onSave: (patch: Partial<RecurringCost>) => void;
  /** Receives the form's in-progress draft so the parent can decide whether
   *  to discard, persist as partial, or remove the row. See WR-10 fix. */
  onCancel: (draft: { name: string }) => void;
}) {
  const [name, setName] = useState(item.name);
  const [store, setStore] = useState(item.store);
  const [source, setSource] = useState<CostSource>(item.source);
  // Phase 12.5.x (2026-05-24) — two cost shapes: fixed CAD per month, or
  // % of revenue. Hydrated from the existing item — a positive
  // percentOfRevenue means the row was saved as a percent row, otherwise
  // fixed (backwards compat with rows that pre-date this feature).
  const initialKind: 'fixed' | 'percent' =
    typeof item.percentOfRevenue === 'number' && item.percentOfRevenue > 0
      ? 'percent'
      : 'fixed';
  const [kind, setKind] = useState<'fixed' | 'percent'>(initialKind);
  const [monthlyCAD, setMonthlyCAD] = useState(String(item.monthlyCAD));
  const [percentInput, setPercentInput] = useState(
    initialKind === 'percent' ? String(item.percentOfRevenue ?? '') : '',
  );
  const [notes, setNotes] = useState(item.notes ?? '');
  // Audit fix 2026-05-23 (d/MD-07): inline validation error so invalid
  // numeric input does not silently commit as 0.
  const [editError, setEditError] = useState<string | null>(null);

  function commit() {
    if (kind === 'percent') {
      const pct = parseFloat(percentInput.replace(/,/g, ''));
      // 0 < pct ≤ 100 — anything outside is operator error. We don't clamp:
      // 110% would silently persist as a 110% charge; surface the validation
      // error so the user fixes it instead.
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setEditError('הזן אחוז בין 0 ל-100 (לדוגמה: 5)');
        return;
      }
      setEditError(null);
      onSave({
        name: name.trim() || '(ללא שם)',
        store,
        source,
        // monthlyCAD irrelevant for percent rows but kept as 0 to avoid
        // showing stale CAD next to the % chip in the list view.
        monthlyCAD: 0,
        percentOfRevenue: pct,
        notes: notes.trim() || undefined,
      });
      return;
    }
    const amount = parseFloat(monthlyCAD.replace(/,/g, ''));
    // Audit fix 2026-05-23 (d/MD-07): block commit when the amount is not
    // a real positive number. Previously a typo (e.g. "five", " ", "abc")
    // produced NaN, the Number.isFinite check fell through to `: 0`, and
    // the row was silently persisted as $0 — corrupting the P&L total.
    // Mirror GoalTracker's pattern: surface an inline error and keep the
    // form open.
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('הזן סכום חיובי תקין (לדוגמה: 60)');
      return;
    }
    setEditError(null);
    onSave({
      name: name.trim() || '(ללא שם)',
      store,
      source,
      monthlyCAD: amount,
      // Clear any prior percent so the row flips back to fixed cleanly.
      percentOfRevenue: undefined,
      notes: notes.trim() || undefined,
    });
  }

  function cancel() {
    onCancel({ name });
  }

  return (
    <div className="p-3 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">שם</label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Klaviyo, Shopify Plan, וכו'"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
          />
        </div>
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">חנות</label>
          <NativeSelect
            value={store}
            onChange={e => setStore(e.target.value)}
          >
            <option value="All">כל החנויות</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">סוג</label>
          <NativeSelect
            value={source}
            onChange={e => setSource(e.target.value as CostSource)}
          >
            {Object.entries(SOURCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">
            {kind === 'percent' ? 'אחוז מהמחזור (%)' : 'סכום חודשי (CAD)'}
          </label>
          {kind === 'percent' ? (
            <Input
              value={percentInput}
              onChange={e => {
                setPercentInput(e.target.value.replace(/[^\d.,]/g, ''));
                if (editError) setEditError(null);
              }}
              inputMode="decimal"
              placeholder="5"
              error={editError ?? undefined}
              onKeyDown={e => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') cancel();
              }}
            />
          ) : (
            <Input
              value={monthlyCAD}
              onChange={e => {
                setMonthlyCAD(e.target.value.replace(/[^\d.,]/g, ''));
                if (editError) setEditError(null);
              }}
              inputMode="numeric"
              placeholder="60"
              error={editError ?? undefined}
              onKeyDown={e => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') cancel();
              }}
            />
          )}
        </div>
      </div>
      {/* Phase 12.5.x (2026-05-24) — type toggle: fixed CAD vs % of revenue.
          Horizon W6.2: hand-rolled 2-button group → shared SegmentedControl
          (role="radiogroup", single-choice). Preserves both values + the
          editError reset on switch. */}
      <div>
        <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">
          חישוב
        </label>
        <div className="mt-1">
          <SegmentedControl
            role="radiogroup"
            aria-label="חישוב — סכום קבוע או אחוז מהמחזור"
            size="sm"
            className="w-full"
            value={kind}
            onChange={v => {
              setKind(v as 'fixed' | 'percent');
              if (editError) setEditError(null);
            }}
            options={[
              { value: 'fixed', label: 'סכום קבוע (CAD)', testId: 'billing-kind-fixed' },
              { value: 'percent', label: '% מהמחזור', testId: 'billing-kind-percent' },
            ]}
          />
        </div>
        <p className="text-fs-2xs text-ink-muted mt-1 leading-relaxed">
          {kind === 'percent'
            ? 'ההוצאה מחושבת כאחוז מהכנסות התקופה (לא חודשי × ימים).'
            : 'הסכום מצוטט חודשי וייפרס ביחס לאורך התקופה.'}
        </p>
      </div>
      <div>
        <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">הערות (אופציונלי)</label>
        <Input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="לדוגמה: Klaviyo Pro plan, מתחיל מ-12.5%"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={commit}
          size="sm"
          className="gap-1"
        >
          <Check size={13} />
          שמור
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={cancel}
        >
          ביטול
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// One-time tab
// ============================================================================

function OneTimeTab({
  items,
  storeNames,
  onChange,
}: {
  items: OneTimeCost[];
  storeNames: string[];
  onChange: (next: OneTimeCost[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  function addNew() {
    const fresh: OneTimeCost = {
      id: generateId(),
      date: new Date().toISOString().slice(0, 10),
      store: storeNames[0] ?? 'All',
      description: '',
      source: 'one-off',
      amountCAD: 0,
    };
    onChange([fresh, ...items]);
    setEditing(fresh.id);
  }
  function remove(id: string) {
    onChange(items.filter(r => r.id !== id));
  }
  function update(id: string, patch: Partial<OneTimeCost>) {
    onChange(items.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Sort newest first.
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.date.localeCompare(a.date)),
    [items],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed">
          חיובים חד-פעמיים: סף-חיוב של Shopify Email, התקנת אפליקציה, ייעוץ, וכל
          הוצאה שלא חוזרת בכל חודש.
        </p>
        <Button
          onClick={addNew}
          size="sm"
          className="shrink-0"
        >
          <Plus size={13} />
          הוסף
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-10 text-ink-muted text-sm">
          <Receipt size={28} className="mx-auto mb-2 text-ink-muted" />
          <div className="inline-flex items-center gap-1">
            אין חיובים חד-פעמיים. ייבא CSV מ-Shopify
            <ArrowLeft size={14} className="shrink-0" aria-hidden="true" />
            או הוסף ידנית.
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map(r => (
            <li key={r.id} className="rounded-lg border border-glass-edge bg-glass-1">
              {editing === r.id ? (
                <OneTimeEditForm
                  item={r}
                  storeNames={storeNames}
                  onSave={patch => {
                    update(r.id, patch);
                    setEditing(null);
                  }}
                  onCancel={(draft) => {
                    // Same WR-10 semantics as RecurringEditForm: keep
                    // partial draft on cancel rather than discarding silently.
                    const trimmed = draft.description.trim();
                    if (!r.description && !trimmed) {
                      remove(r.id);
                    } else if (!r.description && trimmed) {
                      update(r.id, { description: trimmed });
                    }
                    setEditing(null);
                  }}
                />
              ) : (
                <div className="flex items-center gap-3 p-3">
                  <div className="text-fs-2xs text-ink-muted tabular-nums shrink-0 text-center min-w-[64px]">
                    <div className="font-medium text-ink-secondary">{r.date.slice(5)}</div>
                    <div>{r.date.slice(0, 4)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ink">
                        {r.description || '(ללא תיאור)'}
                      </span>
                      <span
                        className={cn(
                          'inline-block text-fs-2xs font-semibold px-1.5 py-0.5 rounded',
                          SOURCE_COLOR[r.source],
                        )}
                      >
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <span className="text-fs-2xs text-ink-muted">
                        {r.store === 'All' ? 'כל החנויות' : r.store}
                      </span>
                    </div>
                    {r.notes && (
                      <div className="text-fs-2xs text-ink-muted mt-0.5">{r.notes}</div>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-sm font-bold tabular-nums text-ink">
                      <Money value={r.amountCAD} prefix="CAD" locale="he-IL" decimals={0} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditing(r.id)}
                      aria-label="ערוך"
                      className="w-8 h-8"
                    >
                      <Edit3 size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(r.id)}
                      aria-label="מחק"
                      className="w-8 h-8 text-ink-muted hover:text-status-redFg hover:bg-status-redBg"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OneTimeEditForm({
  item,
  storeNames,
  onSave,
  onCancel,
}: {
  item: OneTimeCost;
  storeNames: string[];
  onSave: (patch: Partial<OneTimeCost>) => void;
  /** Receives the form's in-progress draft so the parent can decide whether
   *  to discard, persist as partial, or remove the row. See WR-10 fix. */
  onCancel: (draft: { description: string }) => void;
}) {
  const [date, setDate] = useState(item.date);
  const [store, setStore] = useState(item.store);
  const [source, setSource] = useState<CostSource>(item.source);
  const [description, setDescription] = useState(item.description);
  const [amountCAD, setAmountCAD] = useState(String(item.amountCAD));
  const [notes, setNotes] = useState(item.notes ?? '');
  // Audit fix 2026-05-23 (d/MD-07): inline validation error so invalid
  // numeric input does not silently commit as 0.
  const [editError, setEditError] = useState<string | null>(null);

  function commit() {
    const amount = parseFloat(amountCAD.replace(/,/g, ''));
    // Audit fix 2026-05-23 (d/MD-07): block commit when the amount is not
    // a real positive number. Mirror RecurringEditForm.
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('הזן סכום חיובי תקין (לדוגמה: 25)');
      return;
    }
    setEditError(null);
    onSave({
      date,
      store,
      source,
      description: description.trim() || '(ללא תיאור)',
      amountCAD: amount,
      notes: notes.trim() || undefined,
    });
  }

  function cancel() {
    onCancel({ description });
  }

  return (
    <div className="p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">תאריך</label>
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">חנות</label>
          <NativeSelect
            value={store}
            onChange={e => setStore(e.target.value)}
          >
            <option value="All">כל החנויות</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div>
        <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">תיאור</label>
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          autoFocus
          placeholder="לדוגמה: Shopify Email overage"
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">סוג</label>
          <NativeSelect
            value={source}
            onChange={e => setSource(e.target.value as CostSource)}
          >
            {Object.entries(SOURCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">סכום (CAD)</label>
          <Input
            value={amountCAD}
            onChange={e => {
              setAmountCAD(e.target.value.replace(/[^\d.,]/g, ''));
              if (editError) setEditError(null);
            }}
            inputMode="numeric"
            placeholder="25"
            error={editError ?? undefined}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
          />
        </div>
      </div>
      <div>
        <label className="text-fs-2xs text-ink-muted uppercase tracking-wide font-medium">הערות (אופציונלי)</label>
        <Input
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={commit}
          size="sm"
          className="gap-1"
        >
          <Check size={13} />
          שמור
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={cancel}
        >
          ביטול
        </Button>
      </div>
    </div>
  );
}

// CSV Import tab extracted to ./BillingCsvImport.tsx in Phase 4 task T-K.

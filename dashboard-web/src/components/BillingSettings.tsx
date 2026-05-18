'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Receipt,
  Plus,
  Trash2,
  Upload,
  X,
  Edit3,
  Check,
  AlertCircle,
  Sparkles,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import {
  findMatchingRecurring,
  generateId,
  hasAnyBilling,
  parseShopifyBillsCsv,
  seedBillingIfEmpty,
  shopifyPlanCadForName,
  type CostSource,
  type OneTimeCost,
  type ParsedBillLine,
  type RecurringCost,
} from '@/lib/billing';
import { isHydrated } from '@/lib/cloudSync';
import { FROZEN_USD_TO_CAD } from '@/lib/constants';
import { useBillingRecurring } from '@/lib/hooks/useBillingRecurring';
import { useBillingOneTime } from '@/lib/hooks/useBillingOneTime';
import { BillingCsvImport } from './BillingCsvImport';

type StoreMetaRow = {
  storeId: string;
  storeName: string;
  planDisplayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  updatedAt: string | null;
  /** When Apps Script's Shopify GraphQL call failed (missing scope, expired
   *  token, etc.), refreshAllStoreMeta writes the reason into the store-meta
   *  tab. We surface this so the user understands why auto-detect isn't
   *  populating plans rather than silently showing nothing. */
  lastError?: string | null;
};
type StoreMetaResponse = { rows: StoreMetaRow[]; lastUpdated?: string; error?: string };

const metaFetcher = async (url: string): Promise<StoreMetaResponse> => {
  const r = await fetch(url);
  if (!r.ok) return { rows: [] };
  return (await r.json()) as StoreMetaResponse;
};

/**
 * Billing settings panel — manage recurring monthly costs (Shopify plan,
 * external apps like Klaviyo, email service) + one-time / overage charges.
 *
 * Open via the trigger pill. Inside:
 *   - Two tabs: "חודשי קבוע" (recurring) and "חיובים חד-פעמיים" (one-off)
 *   - Drag-and-drop / paste Shopify Bills CSV to bulk-import one-time charges
 *   - Edit any row inline
 *   - Delete with confirmation
 *
 * Storage: localStorage via lib/billing helpers. Future: same shapes flow
 * over the wire when we move to multi-device sync.
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

export const SOURCE_COLOR: Record<CostSource, string> = {
  'shopify-plan': 'bg-primary/10 text-primary',
  'shopify-app':  'bg-blue-100 text-blue-700',
  'external-app': 'bg-purple-100 text-purple-700',
  email:          'bg-amber-100 text-amber-700',
  usage:          'bg-roas-orangeBg text-roas-orange',
  'one-off':      'bg-text-muted/15 text-text-secondary',
  other:          'bg-text-muted/15 text-text-secondary',
};

export function BillingSettings({ storeNames }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('recurring');
  // Cloud-synced billing state lives in two custom hooks. Both subscribe to
  // the SAME `'roas-billing-changed'` event (cloudSync.ts:58-66 maps both
  // billing keys to one event). The hooks' returned setters write through
  // to localStorage + cloud + event via `writeRecurring` / `writeOneTime`.
  const { recurring, setRecurring: persistRecurring, totalMonthly } = useBillingRecurring();
  const { oneTime, setOneTime: persistOneTime } = useBillingOneTime();

  // Auto-detected Shopify plan per store (from Apps Script writing to the
  // `store-meta` tab). Only fetched after the panel opens — no point pinging
  // Sheets if the user never opens the settings.
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
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 sm:gap-2 rounded-lg',
          'bg-surface hover:bg-surfaceMuted text-text-secondary hover:text-text-primary',
          'border border-borderSubtle hover:border-border',
          'px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-colors shrink-0',
        )}
        title="הגדרות עלויות חודשיות"
      >
        <SettingsIcon size={14} />
        <span>עלויות חודשיות</span>
        <span className="hidden sm:inline text-text-muted tabular-nums">
          ({recurring.filter(r => r.active).length} פעילות · CAD {formatCurrency(totalMonthly)})
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-text-primary/35 backdrop-blur-sm animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            dir="rtl"
            className="bg-surface w-full sm:max-w-3xl sm:mx-4 rounded-t-2xl sm:rounded-2xl shadow-elevated border border-borderSubtle max-h-[92vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-borderSubtle">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
                  <Receipt size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-semibold text-text-primary tracking-tight truncate">
                    עלויות חודשיות
                  </h2>
                  <p className="text-[10px] sm:text-xs text-text-muted mt-0.5 truncate">
                    Shopify plan, אפליקציות, שירותים — מתעדכנים ב-P&amp;L האמיתי
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-surfaceMuted text-text-muted hover:text-text-primary"
                aria-label="סגור"
              >
                <X size={18} />
              </button>
            </header>

            {/* Tabs */}
            <nav className="px-4 sm:px-5 py-2 border-b border-borderSubtle flex items-center gap-1">
              {([
                { key: 'recurring' as Tab, label: 'חודשי קבוע', count: recurring.length },
                { key: 'onetime' as Tab, label: 'חד-פעמיים', count: oneTime.length },
                { key: 'import' as Tab, label: 'ייבא CSV מ-Shopify', count: 0 },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors',
                    tab === t.key
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-secondary hover:bg-surfaceMuted',
                  )}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className="ml-1.5 inline-block text-[10px] tabular-nums text-text-muted">
                      ({t.count})
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
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
            </div>
          </div>
        </div>
      )}
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

  // Stores whose Apps Script auto-detect call failed (missing scope, expired
  // token, GraphQL error). We surface these so the user can fix the root
  // cause instead of wondering why auto-detect isn't suggesting anything.
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-amber-100 text-amber-700 shrink-0">
              <AlertCircle size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-amber-900">
                זיהוי אוטומטי של תוכניות Shopify נכשל
              </div>
              <p className="text-[11px] sm:text-xs text-amber-900/85 mt-0.5 leading-relaxed">
                Apps Script נכשל בקריאת ה-plan דרך GraphQL Admin API. סיבות
                נפוצות: ה-token לא כולל את ה-scope <code>read_shop</code>,
                ה-token פג, או החנות חסומה. תיקון נדרש בצד Apps Script
                (Script Properties). עד אז ניתן להוסיף את התוכניות ידנית.
              </p>
              <ul className="mt-2 space-y-1">
                {planErrorStores.map(m => (
                  <li
                    key={m.storeId}
                    className="rounded-md bg-surface border border-amber-200 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-primary shrink-0">
                        {m.storeName}
                      </span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {m.updatedAt ? `עודכן ${m.updatedAt}` : ''}
                      </span>
                    </div>
                    <div
                      dir="ltr"
                      className="text-[10px] text-amber-900/80 font-mono mt-1 break-words"
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
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-primary/15 text-primary shrink-0">
              <Sparkles size={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs sm:text-sm font-semibold text-text-primary">
                  זיהינו אוטומטית תוכניות Shopify
                </div>
                {missingDetected.length > 1 && (
                  <button
                    onClick={addAllDetected}
                    className="text-[11px] sm:text-xs font-semibold text-primary hover:text-primary-dark"
                  >
                    הוסף את כולן ({missingDetected.length})
                  </button>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-text-secondary mt-0.5 leading-relaxed">
                שלפנו את שם התוכנית דרך GraphQL ושיערנו את העלות החודשית
                ב-CAD. סכומים מבוססים על מחירון Shopify הציבורי.
              </p>
              <ul className="mt-2 space-y-1">
                {missingDetected.map(m => {
                  const cad = shopifyPlanCadForName(m.planDisplayName);
                  return (
                    <li
                      key={m.storeId}
                      className="flex items-center gap-2 rounded-md bg-surface border border-borderSubtle px-2.5 py-1.5"
                    >
                      <span className="text-xs text-text-secondary shrink-0">
                        {m.storeName}
                      </span>
                      <span className="text-xs font-semibold text-text-primary truncate">
                        {m.planDisplayName}
                      </span>
                      <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                        {cad ? `≈ CAD ${formatCurrency(cad)}/מ` : 'מחיר לא ידוע — הזן ידנית'}
                      </span>
                      <button
                        onClick={() => addDetectedPlan(m)}
                        className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary text-white px-2 py-0.5 text-[11px] font-semibold hover:bg-primary-dark shrink-0"
                      >
                        <Plus size={11} />
                        הוסף
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
          מנויים חודשיים שחוזרים אוטומטית בכל חודש. Shopify plan, אפליקציות
          חיצוניות (Klaviyo וכו&apos;), שירות אימייל. כל שורה פעילה תיכלל ב-P&amp;L.
        </p>
        <button
          onClick={addNew}
          className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark shrink-0"
        >
          <Plus size={13} />
          הוסף
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-10 text-text-muted text-sm">
          <Receipt size={28} className="mx-auto mb-2 text-text-muted/60" />
          <div>אין מנויים חודשיים. לחץ "הוסף" כדי להתחיל.</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(r => (
            <li
              key={r.id}
              className={cn(
                'rounded-lg border bg-surface',
                r.active ? 'border-borderSubtle' : 'border-borderSubtle/50 opacity-60',
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
                  <input
                    type="checkbox"
                    checked={r.active}
                    onChange={e => update(r.id, { active: e.target.checked })}
                    className="w-4 h-4 rounded text-primary cursor-pointer"
                    title={r.active ? 'פעיל' : 'מושעה'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text-primary">
                        {r.name || '(ללא שם)'}
                      </span>
                      <span
                        className={cn(
                          'inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded',
                          SOURCE_COLOR[r.source],
                        )}
                      >
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {r.store === 'All' ? 'כל החנויות' : r.store}
                      </span>
                    </div>
                    {r.notes && (
                      <div className="text-[11px] text-text-muted mt-0.5">{r.notes}</div>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-sm font-bold tabular-nums text-text-primary">
                      <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
                      {formatCurrency(r.monthlyCAD)}
                    </div>
                    <div className="text-[10px] text-text-muted">/חודש</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(r.id)}
                      className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surfaceMuted"
                      aria-label="ערוך"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="p-1.5 rounded text-text-muted hover:text-roas-red hover:bg-roas-redBg"
                      aria-label="מחק"
                    >
                      <Trash2 size={14} />
                    </button>
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
  const [monthlyCAD, setMonthlyCAD] = useState(String(item.monthlyCAD));
  const [notes, setNotes] = useState(item.notes ?? '');

  function commit() {
    const amount = parseFloat(monthlyCAD.replace(/,/g, ''));
    onSave({
      name: name.trim() || '(ללא שם)',
      store,
      source,
      monthlyCAD: Number.isFinite(amount) ? amount : 0,
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
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">שם</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Klaviyo, Shopify Plan, וכו'"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">חנות</label>
          <select
            value={store}
            onChange={e => setStore(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          >
            <option value="All">כל החנויות</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">סוג</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value as CostSource)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          >
            {Object.entries(SOURCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">סכום חודשי (CAD)</label>
          <input
            value={monthlyCAD}
            onChange={e => setMonthlyCAD(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="numeric"
            placeholder="60"
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus tabular-nums"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">הערות (אופציונלי)</label>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="לדוגמה: Klaviyo Pro plan, מתחיל מ-12.5%"
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={commit}
          className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark"
        >
          <Check size={13} />
          שמור
        </button>
        <button
          onClick={cancel}
          className="inline-flex items-center gap-1 rounded-lg border border-border text-text-secondary hover:text-text-primary px-3 py-1.5 text-xs sm:text-sm"
        >
          ביטול
        </button>
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
        <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
          חיובים חד-פעמיים: סף-חיוב של Shopify Email, התקנת אפליקציה, ייעוץ, וכל
          הוצאה שלא חוזרת בכל חודש.
        </p>
        <button
          onClick={addNew}
          className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark shrink-0"
        >
          <Plus size={13} />
          הוסף
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-10 text-text-muted text-sm">
          <Receipt size={28} className="mx-auto mb-2 text-text-muted/60" />
          <div>אין חיובים חד-פעמיים. ייבא CSV מ-Shopify ⬅️ או הוסף ידנית.</div>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map(r => (
            <li key={r.id} className="rounded-lg border border-borderSubtle bg-surface">
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
                  <div className="text-[10px] sm:text-[11px] text-text-muted tabular-nums shrink-0 text-center min-w-[64px]">
                    <div className="font-medium text-text-secondary">{r.date.slice(5)}</div>
                    <div>{r.date.slice(0, 4)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text-primary">
                        {r.description || '(ללא תיאור)'}
                      </span>
                      <span
                        className={cn(
                          'inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded',
                          SOURCE_COLOR[r.source],
                        )}
                      >
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <span className="text-[11px] text-text-muted">
                        {r.store === 'All' ? 'כל החנויות' : r.store}
                      </span>
                    </div>
                    {r.notes && (
                      <div className="text-[11px] text-text-muted mt-0.5">{r.notes}</div>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-sm font-bold tabular-nums text-text-primary">
                      <span className="text-[10px] text-text-muted font-medium ml-1">CAD</span>
                      {formatCurrency(r.amountCAD)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(r.id)}
                      className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surfaceMuted"
                      aria-label="ערוך"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(r.id)}
                      className="p-1.5 rounded text-text-muted hover:text-roas-red hover:bg-roas-redBg"
                      aria-label="מחק"
                    >
                      <Trash2 size={14} />
                    </button>
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

  function commit() {
    const amount = parseFloat(amountCAD.replace(/,/g, ''));
    onSave({
      date,
      store,
      source,
      description: description.trim() || '(ללא תיאור)',
      amountCAD: Number.isFinite(amount) ? amount : 0,
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
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">תאריך</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:border-primary focus:shadow-focus"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">חנות</label>
          <select
            value={store}
            onChange={e => setStore(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          >
            <option value="All">כל החנויות</option>
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">תיאור</label>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          autoFocus
          placeholder="לדוגמה: Shopify Email overage"
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">סוג</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value as CostSource)}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          >
            {Object.entries(SOURCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">סכום (CAD)</label>
          <input
            value={amountCAD}
            onChange={e => setAmountCAD(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="numeric"
            placeholder="25"
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus tabular-nums"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">הערות (אופציונלי)</label>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={commit}
          className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark"
        >
          <Check size={13} />
          שמור
        </button>
        <button
          onClick={cancel}
          className="inline-flex items-center gap-1 rounded-lg border border-border text-text-secondary hover:text-text-primary px-3 py-1.5 text-xs sm:text-sm"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

// CSV Import tab extracted to ./BillingCsvImport.tsx in Phase 4 task T-K.

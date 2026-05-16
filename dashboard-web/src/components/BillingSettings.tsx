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
  parseShopifyBillsCsv,
  readOneTime,
  readRecurring,
  seedBillingIfEmpty,
  shopifyPlanCadForName,
  writeOneTime,
  writeRecurring,
  type CostSource,
  type OneTimeCost,
  type ParsedBillLine,
  type RecurringCost,
} from '@/lib/billing';

type StoreMetaRow = {
  storeId: string;
  storeName: string;
  planDisplayName: string;
  shopifyPlus: boolean;
  partnerDevelopment: boolean;
  updatedAt: string | null;
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

const SOURCE_LABEL: Record<CostSource, string> = {
  'shopify-plan': 'Shopify Plan',
  'shopify-app':  'אפליקציה דרך Shopify',
  'external-app': 'אפליקציה חיצונית',
  email:          'שירות אימייל',
  usage:          'חיוב סף / overage',
  'one-off':      'חד-פעמי',
  other:          'אחר',
};

const SOURCE_COLOR: Record<CostSource, string> = {
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
  const [recurring, setRecurring] = useState<RecurringCost[]>([]);
  const [oneTime, setOneTime] = useState<OneTimeCost[]>([]);

  // Auto-detected Shopify plan per store (from Apps Script writing to the
  // `store-meta` tab). Only fetched after the panel opens — no point pinging
  // Sheets if the user never opens the settings.
  const { data: meta } = useSWR<StoreMetaResponse>(
    open ? '/api/store-meta' : null,
    metaFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  const detectedPlans: StoreMetaRow[] = meta?.rows ?? [];

  // Hydrate from storage on mount + seed if empty so user has something to edit.
  useEffect(() => {
    seedBillingIfEmpty(storeNames);
    setRecurring(readRecurring());
    setOneTime(readOneTime());
    function onChange() {
      setRecurring(readRecurring());
      setOneTime(readOneTime());
    }
    window.addEventListener('roas-billing-changed', onChange);
    return () => window.removeEventListener('roas-billing-changed', onChange);
  }, [storeNames]);

  // Counts for the trigger pill subtitle.
  const totalMonthly = useMemo(
    () => recurring.filter(r => r.active).reduce((s, r) => s + r.monthlyCAD, 0),
    [recurring],
  );

  function persistRecurring(next: RecurringCost[]) {
    setRecurring(next);
    writeRecurring(next);
  }
  function persistOneTime(next: OneTimeCost[]) {
    setOneTime(next);
    writeOneTime(next);
  }

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
                <ImportTab
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
          ? `Auto-detected מ-Shopify GraphQL · USD→CAD ×1.36`
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
            ? `Auto-detected מ-Shopify GraphQL · USD→CAD ×1.36`
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
                  onCancel={() => {
                    if (!r.name) remove(r.id);
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
  onCancel: () => void;
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
              if (e.key === 'Escape') onCancel();
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
              if (e.key === 'Escape') onCancel();
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
          onClick={onCancel}
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
                  onCancel={() => {
                    if (!r.description) remove(r.id);
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
  onCancel: () => void;
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
            if (e.key === 'Escape') onCancel();
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
              if (e.key === 'Escape') onCancel();
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
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-lg border border-border text-text-secondary hover:text-text-primary px-3 py-1.5 text-xs sm:text-sm"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// CSV Import tab
// ============================================================================

type PreviewRow = ParsedBillLine & {
  /** Whether the user has flipped the suggested type. We track this so the
   *  UI can highlight rows the user actively decided about. */
  type: 'recurring' | 'onetime';
  /** Local edit: store the user wants to attribute this line to. */
  store: string;
  /** Whether to skip this row when importing. Defaults to false; flips true
   *  when we detect a duplicate against an existing recurring entry. */
  skip: boolean;
  /** Set when there's a matching recurring entry — used to show a "duplicate"
   *  hint and pre-select skip. */
  duplicateOfId?: string;
};

function ImportTab({
  storeNames,
  currentRecurring,
  onImported,
}: {
  storeNames: string[];
  currentRecurring: RecurringCost[];
  onImported: (
    newRecurring: RecurringCost[],
    newOneTime: OneTimeCost[],
    destination: 'recurring' | 'onetime',
  ) => void;
}) {
  const [csv, setCsv] = useState('');
  const [defaultStore, setDefaultStore] = useState(storeNames[0] ?? 'All');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function buildPreview(parsed: ParsedBillLine[]): PreviewRow[] {
    return parsed.map(p => {
      const dupe = findMatchingRecurring(p, defaultStore, currentRecurring);
      return {
        ...p,
        type: p.suggestedType,
        store: defaultStore,
        // If we found a match in current recurring, default to skip so the user
        // doesn't double-add Klaviyo every month.
        skip: !!dupe,
        duplicateOfId: dupe?.id,
      };
    });
  }

  function parse() {
    const { parsed, warnings } = parseShopifyBillsCsv(csv, defaultStore);
    setPreview(buildPreview(parsed));
    setWarnings(warnings);
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCsv(text);
      const { parsed, warnings } = parseShopifyBillsCsv(text, defaultStore);
      setPreview(buildPreview(parsed));
      setWarnings(warnings);
    };
    reader.readAsText(file);
  }

  function setRow(id: string, patch: Partial<PreviewRow>) {
    setPreview(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function confirm() {
    const newRecurring: RecurringCost[] = [];
    const newOneTime: OneTimeCost[] = [];
    for (const row of preview) {
      if (row.skip) continue;
      if (row.type === 'recurring') {
        newRecurring.push({
          id: generateId(),
          store: row.store,
          name: row.description,
          source: row.source,
          monthlyCAD: row.amountCAD,
          active: true,
          notes: row.notes,
        });
      } else {
        newOneTime.push({
          id: generateId(),
          date: row.date,
          store: row.store,
          description: row.description,
          source: row.source,
          amountCAD: row.amountCAD,
          notes: row.notes,
        });
      }
    }
    // Decide which tab to show after import. If most lines went to recurring,
    // show that tab; otherwise show one-time. Mixed imports get the bigger one.
    const destination: 'recurring' | 'onetime' =
      newRecurring.length >= newOneTime.length ? 'recurring' : 'onetime';
    onImported(newRecurring, newOneTime, destination);
    setCsv('');
    setPreview([]);
    setWarnings([]);
  }

  const counts = useMemo(() => {
    const rec = preview.filter(r => !r.skip && r.type === 'recurring').length;
    const ot = preview.filter(r => !r.skip && r.type === 'onetime').length;
    const skipped = preview.filter(r => r.skip).length;
    return { rec, ot, skipped };
  }, [preview]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-surfaceMuted/60 border border-borderSubtle p-3 text-xs sm:text-sm text-text-secondary leading-relaxed">
        <p className="mb-1">
          <strong>איך מוציאים CSV מ-Shopify:</strong>
        </p>
        <ol className="list-decimal list-inside space-y-0.5 mr-3">
          <li>Shopify Admin → Settings → Billing → Bill history</li>
          <li>בחר את החודש הרצוי → לחץ &quot;Export&quot;</li>
          <li>Shopify ישלח CSV למייל שלך</li>
          <li>הורד את הקובץ מהמייל → גרור לכאן או הדבק</li>
        </ol>
        <p className="mt-2 text-text-muted leading-relaxed">
          <strong>חכמה אוטומטית:</strong> שורות שנראות כמו מנוי חודשי (Shopify
          Plan, Klaviyo Pro וכו&apos;) יסומנו כ&quot;חודשי קבוע&quot;. שורות שנראות
          חד-פעמיות (overage, threshold, setup) יסומנו כ&quot;חד-פעמיות&quot;.
          אתה יכול להחליף כל שורה. כפילויות מסומנות אוטומטית להדלגה.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">חנות יעד</label>
          <select
            value={defaultStore}
            onChange={e => {
              setDefaultStore(e.target.value);
              // Re-bind store on existing preview rows.
              setPreview(prev => prev.map(r => ({ ...r, store: e.target.value })));
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm focus:outline-none focus:border-primary focus:shadow-focus"
          >
            {storeNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-white px-3 py-2 text-xs sm:text-sm font-semibold hover:bg-primary-dark"
        >
          <Upload size={14} />
          בחר קובץ
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      <div>
        <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">או הדבק כאן את ה-CSV</label>
        <textarea
          value={csv}
          onChange={e => setCsv(e.target.value)}
          placeholder="Bill number,Issue date,Currency,Total,..."
          rows={6}
          dir="ltr"
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-primary focus:shadow-focus"
        />
        <button
          onClick={parse}
          disabled={!csv.trim()}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-surface border border-border hover:border-primary/40 px-3 py-1.5 text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          נתח
        </button>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900">
            {warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}

      {preview.length > 0 && (
        <div className="rounded-lg border border-borderSubtle overflow-hidden">
          <header className="flex items-center justify-between gap-2 px-3 py-2 bg-surfaceMuted/60 border-b border-borderSubtle flex-wrap">
            <div className="flex items-center gap-3 text-[11px] sm:text-xs text-text-secondary tabular-nums">
              <span>
                <strong className="text-text-primary">{counts.rec}</strong> חודשיים
              </span>
              <span>
                <strong className="text-text-primary">{counts.ot}</strong> חד-פעמיים
              </span>
              {counts.skipped > 0 && (
                <span className="text-text-muted">
                  <strong>{counts.skipped}</strong> דילוגים
                </span>
              )}
            </div>
            <button
              onClick={confirm}
              disabled={counts.rec + counts.ot === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-primary text-white px-3 py-1.5 text-xs sm:text-sm font-semibold hover:bg-primary-dark disabled:bg-text-muted disabled:cursor-not-allowed"
            >
              <Check size={13} />
              ייבא ({counts.rec + counts.ot})
            </button>
          </header>
          <ul className="divide-y divide-borderSubtle max-h-80 overflow-y-auto">
            {preview.map(p => (
              <li
                key={p.id}
                className={cn(
                  'px-3 py-2 flex items-center gap-2',
                  p.skip && 'opacity-50',
                )}
              >
                <input
                  type="checkbox"
                  checked={!p.skip}
                  onChange={e => setRow(p.id, { skip: !e.target.checked })}
                  className="w-3.5 h-3.5 rounded cursor-pointer shrink-0"
                  title={p.skip ? 'בחר כדי לייבא' : 'בטל כדי לדלג על שורה זו'}
                />
                <span className="text-[10px] text-text-muted tabular-nums min-w-[56px] shrink-0">
                  {p.date.slice(5)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {p.description}
                  </div>
                  {p.duplicateOfId && (
                    <div className="text-[10px] text-amber-700 mt-0.5">
                      ⚠️ קיים כבר במנויים הפעילים — דילוג ברירת מחדל
                    </div>
                  )}
                </div>
                {/* Type toggle — segmented control */}
                <div
                  className="inline-flex rounded-md border border-border bg-surface overflow-hidden text-[10px] shrink-0"
                  dir="ltr"
                >
                  <button
                    onClick={() => setRow(p.id, { type: 'recurring' })}
                    className={cn(
                      'px-1.5 py-0.5 transition-colors',
                      p.type === 'recurring'
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:bg-surfaceMuted',
                    )}
                  >
                    חודשי
                  </button>
                  <button
                    onClick={() => setRow(p.id, { type: 'onetime' })}
                    className={cn(
                      'px-1.5 py-0.5 transition-colors border-r border-border',
                      p.type === 'onetime'
                        ? 'bg-primary text-white'
                        : 'text-text-secondary hover:bg-surfaceMuted',
                    )}
                  >
                    חד-פעמי
                  </button>
                </div>
                <span
                  className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0',
                    SOURCE_COLOR[p.source],
                  )}
                >
                  {SOURCE_LABEL[p.source]}
                </span>
                <span className="text-xs font-semibold tabular-nums shrink-0 min-w-[68px] text-end">
                  CAD {formatCurrency(p.amountCAD)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

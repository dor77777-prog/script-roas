'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, AlertCircle, Check } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import {
  findMatchingRecurring,
  generateId,
  parseShopifyBillsCsv,
  type OneTimeCost,
  type ParsedBillLine,
  type RecurringCost,
} from '@/lib/billing';
import { SOURCE_COLOR, SOURCE_LABEL } from './BillingSettings';

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

type Props = {
  storeNames: string[];
  currentRecurring: RecurringCost[];
  onImported: (
    newRecurring: RecurringCost[],
    newOneTime: OneTimeCost[],
    destination: 'recurring' | 'onetime',
  ) => void;
};

export function BillingCsvImport({
  storeNames,
  currentRecurring,
  onImported,
}: Props) {
  const [csv, setCsv] = useState('');
  const [defaultStore, setDefaultStore] = useState(storeNames[0] ?? 'All');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // useState only seeds `defaultStore` from `storeNames[0]` at mount, so if
  // the parent's SWR refetch returns a new `data.stores` list (e.g. after
  // a newly-onboarded store appears, or after a store is removed) the
  // <select>'s value can fall off the option list. React then renders a
  // <select> whose value matches no <option>, which produces a DOM warning
  // and silently shows whatever the browser picks. Sync via effect when
  // `defaultStore` is no longer in `storeNames`. We also recompute the
  // duplicate-flag on preview rows for the same reason CR-01 fixed the
  // user-driven onChange path: `findMatchingRecurring` is store-scoped, so
  // the silent store switch must trigger the same skip/duplicateOfId
  // recomputation. (WR-02)
  useEffect(() => {
    if (!storeNames.includes(defaultStore) && defaultStore !== 'All') {
      const next = storeNames[0] ?? 'All';
      setDefaultStore(next);
      setPreview(prev => prev.map(r => {
        const dupe = findMatchingRecurring(r, next, currentRecurring);
        return {
          ...r,
          store: next,
          skip: !!dupe,
          duplicateOfId: dupe?.id,
        };
      }));
    }
  }, [storeNames, defaultStore, currentRecurring]);

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
              const next = e.target.value;
              setDefaultStore(next);
              // Re-bind store AND recompute the duplicate flag against the
              // new store. `findMatchingRecurring` is store-scoped, so a row
              // that was duplicate-against-Store-A may be unique-to-Store-B
              // (or vice versa). Without the recompute, the `skip` checkbox
              // stays pinned to its old-store value, which silently
              // double-adds recurring costs to P&L when the user changes
              // destinations mid-import. (CR-01)
              setPreview(prev => prev.map(r => {
                const dupe = findMatchingRecurring(r, next, currentRecurring);
                return {
                  ...r,
                  store: next,
                  skip: !!dupe,
                  duplicateOfId: dupe?.id,
                };
              }));
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

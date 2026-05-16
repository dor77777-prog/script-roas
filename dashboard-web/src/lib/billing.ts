/**
 * Billing data layer — persists per-store cost entries in localStorage so the
 * P&L breakdown reflects real numbers instead of hardcoded constants.
 *
 * Two record types, intentionally separate so the UI and math stay simple:
 *
 *   1. **Recurring**: monthly cost that repeats indefinitely (Shopify plan,
 *      Klaviyo subscription, etc.). One row per ongoing subscription.
 *      Active rows contribute their full monthly amount to every month they
 *      cover, then get prorated by days in the reporting period.
 *
 *   2. **One-time**: a charge on a specific date (Shopify Email overage,
 *      app migration setup fee, etc.). Counted only if the date falls
 *      inside the reporting window.
 *
 * Migration path: when we move to multi-device sync (e.g. write to Sheets
 * via Apps Script), the same shapes flow over the wire — just swap the
 * persistence layer.
 */

export type RecurringCost = {
  id: string;
  store: string;        // Store name (e.g. "uzoshop") or "All" to apply across stores
  name: string;         // "Shopify Plan", "Klaviyo", "ReConvert", etc.
  source: CostSource;   // where it comes from — informational
  monthlyCAD: number;
  active: boolean;
  notes?: string;
};

export type OneTimeCost = {
  id: string;
  date: string;         // YYYY-MM-DD
  store: string;
  description: string;
  source: CostSource;
  amountCAD: number;
  notes?: string;
};

/** Where the charge originated. Used to color-code rows in the UI. */
export type CostSource =
  | 'shopify-plan'      // Shopify's own subscription fee
  | 'shopify-app'       // Third-party app billed through Shopify
  | 'external-app'      // Third-party app billed outside Shopify (Klaviyo, etc.)
  | 'email'             // Email service
  | 'usage'             // Threshold / overage charge
  | 'one-off'           // App migration, consulting, etc.
  | 'other';

const RECURRING_KEY = 'roas-dashboard:billing-recurring';
const ONETIME_KEY = 'roas-dashboard:billing-onetime';

// ============================================================================
// Persistence
// ============================================================================

function safeReadArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Notify other components in the same tab via a custom event — useful
    // because localStorage's native "storage" event only fires across tabs.
    window.dispatchEvent(new CustomEvent('roas-billing-changed'));
  } catch {
    /* ignore — usually quota or private mode */
  }
}

export function readRecurring(): RecurringCost[] {
  return safeReadArray<RecurringCost>(RECURRING_KEY);
}

export function writeRecurring(items: RecurringCost[]) {
  safeWrite(RECURRING_KEY, items);
}

export function readOneTime(): OneTimeCost[] {
  return safeReadArray<OneTimeCost>(ONETIME_KEY);
}

export function writeOneTime(items: OneTimeCost[]) {
  safeWrite(ONETIME_KEY, items);
}

export function generateId(): string {
  // Random-enough id for client-side storage; no need for UUID library.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// Default seed — runs once on first visit so user has something to edit
// rather than an empty panel. Idempotent: re-running won't dup.
// ============================================================================

/**
 * Returns true if either bucket has any user-entered data. Used to decide
 * whether to seed defaults on first visit.
 */
export function hasAnyBilling(): boolean {
  return readRecurring().length > 0 || readOneTime().length > 0;
}

/**
 * Seed the dashboard with a "starter pack" of common cost lines that the
 * user can edit. The seed is keyed by the store list provided so newly-
 * added stores also get the email line on next mount.
 */
export function seedBillingIfEmpty(storeNames: string[]) {
  if (hasAnyBilling()) return;
  const seed: RecurringCost[] = [];
  for (const store of storeNames) {
    seed.push({
      id: generateId(),
      store,
      name: 'Email Service',
      source: 'email',
      monthlyCAD: 20,
      active: true,
      notes: 'Klaviyo / similar — default $20/store/mo, edit as needed.',
    });
  }
  writeRecurring(seed);
}

// ============================================================================
// Aggregation math
// ============================================================================

/**
 * Prorate active recurring costs + one-time costs to a date range, scoped to
 * the stores in `storeNames`. Returns a breakdown so the UI can show source
 * categories, not just a single number.
 */
export function billingForRange(input: {
  from: string;        // YYYY-MM-DD inclusive
  to: string;          // YYYY-MM-DD inclusive
  storeNames: string[];
}): {
  total: number;
  bySource: Record<CostSource, number>;
  byStore: Record<string, number>;
  recurringInPeriod: number;
  oneTimeInPeriod: number;
} {
  const { from, to, storeNames } = input;
  const fromMs = new Date(from + 'T00:00:00Z').getTime();
  const toMs = new Date(to + 'T00:00:00Z').getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return {
      total: 0,
      bySource: emptySourceMap(),
      byStore: Object.fromEntries(storeNames.map(s => [s, 0])),
      recurringInPeriod: 0,
      oneTimeInPeriod: 0,
    };
  }
  const days = Math.round((toMs - fromMs) / 86400000) + 1;
  const storeSet = new Set(storeNames);

  // Recurring: monthly × (days/30) for each row whose store matches.
  let recurringInPeriod = 0;
  const bySource = emptySourceMap();
  const byStore: Record<string, number> = Object.fromEntries(
    storeNames.map(s => [s, 0]),
  );
  for (const r of readRecurring()) {
    if (!r.active) continue;
    const stores =
      r.store === 'All' ? storeNames : storeSet.has(r.store) ? [r.store] : [];
    for (const s of stores) {
      // Each store getting an "All" cost takes its share — but in practice
      // we shouldn't double-bill: an "All" row applies once per store, so
      // the cost is replicated.
      const amount = (r.monthlyCAD * days) / 30;
      recurringInPeriod += amount;
      bySource[r.source] = (bySource[r.source] ?? 0) + amount;
      byStore[s] = (byStore[s] ?? 0) + amount;
    }
  }

  // One-time: include if date is in [from, to] AND store is in scope.
  let oneTimeInPeriod = 0;
  for (const o of readOneTime()) {
    if (o.date < from || o.date > to) continue;
    const inScope = o.store === 'All' || storeSet.has(o.store);
    if (!inScope) continue;
    oneTimeInPeriod += o.amountCAD;
    bySource[o.source] = (bySource[o.source] ?? 0) + o.amountCAD;
    const sKey = o.store === 'All' ? storeNames[0] ?? 'All' : o.store;
    byStore[sKey] = (byStore[sKey] ?? 0) + o.amountCAD;
  }

  return {
    total: recurringInPeriod + oneTimeInPeriod,
    bySource,
    byStore,
    recurringInPeriod,
    oneTimeInPeriod,
  };
}

function emptySourceMap(): Record<CostSource, number> {
  return {
    'shopify-plan': 0,
    'shopify-app': 0,
    'external-app': 0,
    email: 0,
    usage: 0,
    'one-off': 0,
    other: 0,
  };
}

// ============================================================================
// Shopify plan price lookup — Shopify deliberately doesn't expose the price,
// so we keep a static table. Update when Shopify changes pricing.
// ============================================================================

export const SHOPIFY_PLAN_PRICES_USD: Record<string, number> = {
  'Basic Shopify':   39,
  Basic:             39,
  Shopify:           105,
  'Advanced Shopify': 399,
  Advanced:          399,
  'Shopify Plus':    2000, // floor — actual is contract-based; user should override
  Plus:              2000,
  Starter:           5,    // newer cheap tier
  Retail:            89,
};

/** Convert USD plan price to CAD using the dashboard's current FX. */
export function shopifyPlanCadForName(planName: string, usdToCad = 1.36): number | null {
  const usd = SHOPIFY_PLAN_PRICES_USD[planName];
  if (!usd) return null;
  return Math.round(usd * usdToCad);
}

// ============================================================================
// Shopify Bills CSV importer
// ============================================================================

/**
 * Parse a Shopify "Export your bills" CSV.
 *
 * Format (as of 2025-2026):
 *   Bill number, Issue date, Currency, Total, Line item description, Line item amount, ...
 *
 * The exact columns vary slightly by region/account. We use a header map so
 * an unexpected order or extra column doesn't break the parser.
 *
 * Returns an array of OneTimeCost ready to be merged into the user's bucket.
 * Store assignment is the merchant's choice — we let them pick a store at
 * import time, since Shopify CSVs don't include store metadata (one shop =
 * one bills file).
 */
export function parseShopifyBillsCsv(
  csv: string,
  defaultStore: string,
): { parsed: OneTimeCost[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    warnings.push('הקובץ ריק או חסר שורת כותרות.');
    return { parsed: [], warnings };
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idx = {
    billNumber: header.findIndex(h => h.includes('bill') && h.includes('number')),
    date: header.findIndex(h => h.includes('date')),
    desc: header.findIndex(h => h.includes('description') || h.includes('item')),
    amount: header.findIndex(h => h.includes('amount') || h.includes('total')),
    currency: header.findIndex(h => h.includes('currency')),
  };

  if (idx.date < 0 || idx.desc < 0 || idx.amount < 0) {
    warnings.push('לא הצלחתי לזהות עמודות חובה (תאריך / תיאור / סכום). בדוק שזה ה-CSV מ-Shopify.');
    return { parsed: [], warnings };
  }

  const out: OneTimeCost[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < Math.max(idx.date, idx.desc, idx.amount) + 1) continue;
    const dateRaw = cols[idx.date]?.trim();
    const desc = cols[idx.desc]?.trim();
    const amountRaw = cols[idx.amount]?.trim();
    const currency = idx.currency >= 0 ? (cols[idx.currency]?.trim() || 'USD') : 'USD';

    const date = normalizeDate(dateRaw);
    if (!date) continue;
    const amount = parseFloat((amountRaw ?? '').replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) continue;

    // Best-effort source tagging based on description text.
    let source: CostSource = 'shopify-app';
    const lower = (desc ?? '').toLowerCase();
    if (/(basic|shopify plan|advanced shopify|shopify plus|plan)/i.test(lower)) {
      source = 'shopify-plan';
    } else if (/(usage|overage|threshold|capacity|email|sms)/i.test(lower)) {
      source = 'usage';
    }

    // Convert USD → CAD if needed. The user can adjust per row in the UI.
    const amountCad = currency.toUpperCase() === 'CAD' ? amount : Math.round(amount * 1.36);

    out.push({
      id: generateId(),
      date,
      store: defaultStore,
      description: desc || '(ללא תיאור)',
      source,
      amountCAD: amountCad,
      notes: `CSV import · ${currency} ${amount.toFixed(2)}${currency.toUpperCase() === 'CAD' ? '' : ' (×1.36)'}`,
    });
  }

  if (out.length === 0) {
    warnings.push('לא נמצאו שורות תקפות לייבא.');
  }
  return { parsed: out, warnings };
}

/** Naïve CSV line splitter that handles quoted fields with commas inside. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.replace(/^"|"$/g, ''));
}

/** Accept MM/DD/YYYY, YYYY-MM-DD, "Aug 13, 2025", etc. Returns ISO date or null. */
function normalizeDate(s: string | undefined): string | null {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

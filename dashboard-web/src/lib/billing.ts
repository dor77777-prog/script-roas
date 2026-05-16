import { pushCloudKey, type StateKey } from './cloudSync';

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

const RECURRING_KEY: StateKey = 'roas-dashboard:billing-recurring';
const ONETIME_KEY: StateKey = 'roas-dashboard:billing-onetime';

// ============================================================================
// Persistence
// ============================================================================

function safeReadArray<T>(key: StateKey): T[] {
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

function safeWrite<T>(key: StateKey, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Notify other components in the same tab via a custom event — useful
    // because localStorage's native "storage" event only fires across tabs.
    window.dispatchEvent(new CustomEvent('roas-billing-changed'));
    // Mirror to cloud so partners on other devices see the same data.
    pushCloudKey(key, value);
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
 * A row parsed from the Shopify bills CSV. `suggestedType` is set by the
 * heuristic in `parseShopifyBillsCsv` — the import UI lets the user override
 * it per row before deciding the destination bucket.
 */
export type ParsedBillLine = {
  /** Local-only id for the preview list — not stored. */
  id: string;
  date: string;
  description: string;
  source: CostSource;
  amountCAD: number;
  notes?: string;
  /** Heuristic guess: monthly subscription vs one-time charge. */
  suggestedType: 'recurring' | 'onetime';
};

/**
 * Parse a Shopify "Export your bills" CSV.
 *
 * Format (as of 2025-2026):
 *   Bill number, Issue date, Currency, Total, Line item description, Line item amount, ...
 *
 * The exact columns vary slightly by region/account. We use a header map so
 * an unexpected order or extra column doesn't break the parser.
 *
 * For each line we also guess whether it's a recurring subscription (Shopify
 * plan, Klaviyo, ReConvert, etc.) or a one-time charge (overage, threshold,
 * setup, migration). The user can flip any row during preview.
 */
export function parseShopifyBillsCsv(
  csv: string,
  defaultStore: string,
): { parsed: ParsedBillLine[]; warnings: string[] } {
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

  // Use the bundled store arg only as the preview's default scope. The
  // unused-parameter pattern keeps the public signature stable while making
  // it explicit that the importer doesn't bake `defaultStore` into rows
  // anymore (the UI does the routing).
  void defaultStore;

  // First pass over currencies: if any row uses EUR/GBP we assume DMY date
  // formatting (Shopify's EU storefronts emit DD/MM/YYYY), otherwise MDY.
  // This is a best-effort heuristic; the slash-format detector in
  // normalizeDate also catches unambiguous cases (one segment > 12).
  let localeHint: DateLocaleHint = 'mdy';
  if (idx.currency >= 0) {
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const cur = (cols[idx.currency] ?? '').trim().toUpperCase();
      if (cur === 'EUR' || cur === 'GBP') { localeHint = 'dmy'; break; }
    }
  }

  // Track ambiguous dates (both segments ≤ 12) so we can warn the user that
  // the importer picked one interpretation and the other was equally valid.
  let ambiguousSlashCount = 0;

  const out: ParsedBillLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < Math.max(idx.date, idx.desc, idx.amount) + 1) continue;
    const dateRaw = cols[idx.date]?.trim();
    const desc = cols[idx.desc]?.trim();
    const amountRaw = cols[idx.amount]?.trim();
    const currency = idx.currency >= 0 ? (cols[idx.currency]?.trim() || 'USD') : 'USD';

    const date = normalizeDate(dateRaw, localeHint);
    if (!date) continue;
    // Flag ambiguity for the warning summary below.
    const slashMatch = (dateRaw ?? '').match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    if (slashMatch) {
      const an = parseInt(slashMatch[1], 10);
      const bn = parseInt(slashMatch[2], 10);
      if (an <= 12 && bn <= 12 && an !== bn) ambiguousSlashCount++;
    }
    const amount = parseFloat((amountRaw ?? '').replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(amount) || amount === 0) continue;

    const classification = classifyBillLine(desc ?? '');

    // Convert USD → CAD if needed. The user can adjust per row in the UI.
    const amountCad = currency.toUpperCase() === 'CAD' ? amount : Math.round(amount * 1.36);

    out.push({
      id: generateId(),
      date,
      description: desc || '(ללא תיאור)',
      source: classification.source,
      amountCAD: amountCad,
      notes: `CSV import · ${currency} ${amount.toFixed(2)}${currency.toUpperCase() === 'CAD' ? '' : ' (×1.36)'}`,
      suggestedType: classification.suggestedType,
    });
  }

  if (out.length === 0) {
    warnings.push('לא נמצאו שורות תקפות לייבא.');
  }
  if (ambiguousSlashCount > 0) {
    const fmt = localeHint === 'dmy' ? 'DD/MM/YYYY' : 'MM/DD/YYYY';
    warnings.push(
      `יש ${ambiguousSlashCount} תאריכים עם פורמט סלאש דו-משמעי (X/Y/YYYY כאשר X,Y ≤ 12). הם פוענחו כ-${fmt} לפי המטבע. אם החודש לא נכון, בדוק את עמודת התאריך לפני אישור.`,
    );
  }
  return { parsed: out, warnings };
}

/**
 * Heuristic classifier for a single Shopify bill line. Tags both the
 * canonical source (for color coding) and the suggested bucket (recurring
 * subscription vs one-time charge).
 *
 * Recurring "tells" — words that strongly imply a monthly subscription:
 *   plan, subscription, monthly, annual, recurring, app charge (the name
 *   itself usually follows: "Klaviyo: Monthly app charge")
 *
 * One-time "tells" — words that imply a non-recurring event:
 *   overage, threshold, usage, capacity, setup, migration, install, extra,
 *   one-time, refund, credit
 *
 * Default: if neither set of words appears, we assume recurring — most lines
 * on a Shopify bill are app subscriptions, and the user can flip individual
 * rows in the preview.
 */
function classifyBillLine(desc: string): {
  source: CostSource;
  suggestedType: 'recurring' | 'onetime';
} {
  const lower = desc.toLowerCase();

  // Shopify's own plan — strongest signal, always recurring.
  if (/(basic shopify|shopify plus|advanced shopify|shopify plan|^shopify(\s|$)|\bshopify subscription\b)/i.test(lower)) {
    return { source: 'shopify-plan', suggestedType: 'recurring' };
  }

  // One-time markers
  const oneTimeMarkers = /(overage|threshold|usage|capacity|setup|migration|install|extra|one[\s-]?time|refund|credit|adjustment)/i;
  if (oneTimeMarkers.test(lower)) {
    // Within one-times, the "usage" sub-category gets its own color in UI.
    const isUsage = /(overage|threshold|usage|capacity)/i.test(lower);
    return {
      source: isUsage ? 'usage' : 'one-off',
      suggestedType: 'onetime',
    };
  }

  // Recurring markers
  const recurringMarkers = /(subscription|monthly|annual|recurring|app\s?charge|plan|pro|business)/i;
  if (recurringMarkers.test(lower)) {
    return { source: 'shopify-app', suggestedType: 'recurring' };
  }

  // Default: assume recurring app charge — most lines on a Shopify monthly
  // bill ARE recurring app subscriptions; the user can flip in preview.
  return { source: 'shopify-app', suggestedType: 'recurring' };
}

/**
 * Routing decision for an imported parsed line. Tries to find an existing
 * matching recurring entry to avoid duplicates ("the user already added
 * Klaviyo $60, importing this month's bill shouldn't add a second row").
 *
 * Match rule: same description (case-insensitive, trimmed) AND same store
 * AND within ±$2 of the existing amount (Shopify amounts shift by cents).
 */
export function findMatchingRecurring(
  line: ParsedBillLine,
  store: string,
  existing: RecurringCost[],
): RecurringCost | null {
  const desc = line.description.trim().toLowerCase();
  for (const r of existing) {
    if (r.store !== store && r.store !== 'All') continue;
    if (r.name.trim().toLowerCase() !== desc) continue;
    if (Math.abs(r.monthlyCAD - line.amountCAD) <= 2) return r;
  }
  return null;
}

/**
 * CSV line splitter that handles quoted fields with commas inside AND
 * standard CSV escape for an embedded quote, which is a doubled quote
 * (`""`) inside a quoted field. The previous toggle-only implementation
 * silently corrupted fields like `"He said ""hi"""` into `He said hi""`,
 * which would quietly mangle Shopify bill descriptions that contain
 * quotation marks.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field — emit one literal quote and
        // skip the next character.
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Accept MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, "Aug 13, 2025", etc. Returns
 * ISO date or null.
 *
 * Slash-format ambiguity (#WR-08): Shopify bills from EU storefronts use
 * DD/MM/YYYY, US accounts use MM/DD/YYYY. We disambiguate via:
 *   1. If one segment is > 12, it must be the day (the other is the month).
 *   2. Otherwise (both ≤ 12), defer to the optional `localeHint` arg. The
 *      default is 'mdy' to preserve the prior behavior; callers that have
 *      detected an EU bill (e.g. from a Currency=EUR/GBP column) should
 *      pass 'dmy'.
 *
 * The previous unconditional MM/DD interpretation silently attributed EU
 * bills to the wrong month in the P&L (e.g. 03/04/2026 → March 4 instead
 * of April 3).
 */
type DateLocaleHint = 'mdy' | 'dmy';

function normalizeDate(
  s: string | undefined,
  localeHint: DateLocaleHint = 'mdy',
): string | null {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, yyyy] = slashMatch;
    const an = parseInt(a, 10);
    const bn = parseInt(b, 10);
    let mm: string;
    let dd: string;
    if (an > 12 && bn <= 12) {
      // First segment cannot be a month — must be day. Locale is implicitly DMY.
      dd = a;
      mm = b;
    } else if (bn > 12 && an <= 12) {
      // Second segment cannot be a day-as-month — must be day. Locale is MDY.
      mm = a;
      dd = b;
    } else {
      // Both segments ≤ 12: genuinely ambiguous; trust the locale hint.
      if (localeHint === 'dmy') {
        dd = a;
        mm = b;
      } else {
        mm = a;
        dd = b;
      }
    }
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Phase 05.7.9d — per-operator column visibility for the Campaigns table.
 *
 * Operator-side preference store: which columns are HIDDEN in the
 * Campaigns table. Stored in localStorage + cloud-synced to Supabase
 * via `pushCloudKey` so the operator sees the same hidden columns
 * across devices / sessions.
 *
 * Scope is intentionally minimal (per the 2026-05-22 phasing
 * discussion): only hide/show, no reorder yet. Reorder + color
 * customization are Phase B (deferred).
 *
 * Data shape: `string[]` of column IDs that are hidden. An empty array
 * (or missing entry) means "everything visible" — the safe default.
 *
 * Each column in the Campaigns table carries a `data-col-id` attribute
 * matching one of the `CAMPAIGNS_COLUMN_IDS` literals below. A small
 * `<style>` tag injected by the table hides any `[data-col-id='${id}']`
 * cells listed in this prefs object.
 *
 * Pinned columns: some columns (campaign name, deep-link button) are
 * load-bearing for row identity — the UI panel filters them out so the
 * operator can't accidentally hide them.
 */

import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaigns-column-visibility' as const;

/**
 * Canonical list of column IDs in the Campaigns table. Order matches
 * the current visual order left-to-right (Hebrew RTL: rightmost first).
 * If the table renders a new column, add its ID here too — keep this
 * list as the source of truth for the visibility panel.
 *
 * `pinned: true` means the operator CANNOT hide this column from the UI
 * panel. The row identity columns (campaign name, deep-link) are pinned
 * so the table stays usable.
 */
export const CAMPAIGNS_COLUMNS: ReadonlyArray<{
  id: string;
  /** Hebrew label for the visibility panel. Matches the column header. */
  label: string;
  /** When true: not toggle-able. Pinned columns are filtered out of the UI panel. */
  pinned?: boolean;
  /** When true: visible only in mode='campaign' (hidden in mode='adset'). */
  campaignOnly?: boolean;
  /** Brief description shown as panel tooltip. Helps the operator
   *  remember what each column shows before toggling. */
  description?: string;
}> = [
  { id: 'optimized', label: 'סימון אופטימיזציה', description: 'V לסימון "טופל" — לא נחשב למיון/חישוב' },
  { id: 'campaignName', label: 'שם הקמפיין', pinned: true },
  { id: 'budget', label: 'תקציב יומי', campaignOnly: true, description: 'תקציב Meta CBO או ad-set budget' },
  { id: 'spend', label: 'הוצאה', description: 'CAD' },
  { id: 'conversionValue', label: 'ערך המרות', description: 'ערך המרות שדיווחה הפלטפורמה (CAD)' },
  { id: 'roas', label: 'ROAS (פלטפ)', description: 'ערך/הוצאה לפי דיווח הפלטפורמה' },
  { id: 'roasShopify', label: 'ROAS Shopify (מוקצה)', description: 'ROAS מבוסס הכנסה מוקצה (click-id + חלוקה יחסית). המונה: ערך Shopify · מוקצה ÷ הוצאה' },
  { id: 'roasShopifyPlatform', label: 'ROAS Shopify · פלטפורמה', description: 'ROAS מבוסס רק על הזמנות שסווגו ב-Shopify לפלטפורמה הזו (דטרמיניסטי בלבד, ללא fallback)' },
  { id: 'shopifyValuePlatform', label: 'ערך Shopify · פלטפורמה', description: 'מהזמנות שסווגו לפלטפורמה הזו (source/click-id)' },
  { id: 'shopifyValueAllocated', label: 'ערך Shopify · מוקצה', description: 'הכנסת Shopify המוקצה לקמפיין: מתויג click-id + חלק יחסי מהזמנות לא-מתויגות של המוצרים המשויכים — זהו המונה של ROAS Shopify' },
  { id: 'shopifyUnitsPlatform', label: 'יח׳ Shopify · פלטפורמה', description: 'יחידות מהזמנות שסווגו לפלטפורמה הזו' },
  { id: 'shopifyValueTotal', label: 'ערך Shopify · סה"כ', description: 'סך מכירות המוצרים הממופים בכל הפלטפורמות' },
  { id: 'shopifyUnitsTotal', label: 'יח׳ Shopify · סה"כ', description: 'סך היחידות שנמכרו של המוצרים הממופים' },
  { id: 'shopifyOrdersTotal', label: 'הזמנות Shopify · סה"כ', description: 'סך ההזמנות שכללו את המוצרים הממופים בכל הערוצים בטווח (מוצר באותה הזמנה נספר פעם אחת לכל מוצר)' },
  { id: 'conversions', label: 'המרות', description: 'מספר ההמרות שדיווחה הפלטפורמה' },
  { id: 'clicks', label: 'קליקים', description: 'מספר הקליקים שדיווחה הפלטפורמה' },
  { id: 'impressions', label: 'חשיפות', description: 'מספר החשיפות שדיווחה הפלטפורמה' },
  { id: 'ctr', label: 'CTR', description: 'קליקים/חשיפות' },
  { id: 'cpc', label: 'CPC', description: 'עלות לקליק' },
  { id: 'cpm', label: 'CPM', description: 'עלות ל-1000 חשיפות' },
  { id: 'cpa', label: 'CPA', description: 'עלות להמרה' },
  { id: 'deepLink', label: 'קישור ל-Ads Manager', pinned: true },
];

export type CampaignsColumnId = (typeof CAMPAIGNS_COLUMNS)[number]['id'];

export type CampaignsColumnPrefs = {
  hidden: string[];
  /**
   * Phase 05.7.x — user-set order for the reorderable metric columns.
   * List of column IDs in the order the operator wants them rendered.
   * Only the IDs in REORDERABLE_COLUMN_IDS appear here; structural
   * columns (optimized / health / campaignName / deepLink) stay fixed
   * at the table's edges. Missing IDs are appended in the default
   * `CAMPAIGNS_COLUMNS` order so the operator never loses access to a
   * column even if their saved prefs are stale.
   */
  order?: string[];
  /**
   * Schema/migration version (2026-06-01). Bumped when the lean-default
   * declutter shipped so existing operators (who already have saved prefs,
   * and therefore never see the read-time seed) get the new default-hidden
   * columns folded into their `hidden` set exactly once. See
   * `migrateCampaignsColumnPrefs`. Absent on pre-declutter saved prefs.
   */
  v?: number;
};

/**
 * Current prefs schema version. Bump when a new batch of columns should be
 * hidden-by-default for EXISTING operators too (not just fresh ones). The
 * one-time migration unions the new `DEFAULT_HIDDEN_COLUMN_IDS` into the
 * operator's saved `hidden` set the first time it sees an older `v`.
 */
export const CAMPAIGNS_PREFS_VERSION = 2;

/**
 * Columns the operator may reorder. Structural columns are excluded
 * (they live in fixed positions at table edges):
 *   start-fixed: optimized, health, campaignName
 *   end-fixed:   deepLink
 */
export const REORDERABLE_COLUMN_IDS = [
  'spend',
  'budget',
  'conversionValue',
  'roas',
  'roasShopify',
  'roasShopifyPlatform',
  'shopifyValuePlatform',
  'shopifyValueAllocated',
  'shopifyUnitsPlatform',
  'shopifyValueTotal',
  'shopifyUnitsTotal',
  'shopifyOrdersTotal',
  'conversions',
  'clicks',
  'impressions',
  'ctr',
  'cpc',
  'cpm',
  'cpa',
] as const;

/**
 * Columns that ship HIDDEN by default — visible only when the operator
 * explicitly enables them via the "עמודות" menu (so the table doesn't get
 * wider than necessary out of the box). This is the "lean default" declutter
 * set: redundant or low-signal columns whose information is already covered
 * by a visible column, kept toggle-able for power users.
 *
 * Why each is hidden by default:
 *   - budget                → operational, not a performance metric.
 *   - roasShopifyPlatform   → click-id-only ROAS; the visible `roasShopify`
 *                             (allocated) is the headline Shopify ROAS.
 *   - shopifyValuePlatform  → deterministic revenue; covered by the visible
 *                             `shopifyValueAllocated` (the ROAS numerator).
 *   - shopifyValueTotal     → gross all-channel value; informational, not
 *                             attributable to the campaign.
 *   - shopifyUnitsPlatform / shopifyUnitsTotal → unit counts; revenue columns
 *                             carry the signal operators act on.
 *   - clicks / impressions  → raw volume; read via CTR/CPC/CPM instead.
 *   - ctr / cpc / cpm       → funnel diagnostics; off by default to keep the
 *                             table focused on spend → revenue → ROAS.
 *
 * Everything NOT in this set (campaignName, spend, conversionValue, roas,
 * roasShopify[allocated], shopifyValueAllocated, shopifyOrdersTotal,
 * conversions, cpa, plus the structural optimized/health/roasTrend/deepLink)
 * is visible by default.
 *
 * This is the SEED for a fresh operator (no saved prefs yet). Once the
 * operator toggles any column, `hidden` becomes an explicit list written to
 * localStorage and this seed no longer applies — they own the visibility set.
 */
export const DEFAULT_HIDDEN_COLUMN_IDS = [
  'budget',
  'roasShopifyPlatform',
  'shopifyValuePlatform',
  'shopifyUnitsPlatform',
  'shopifyValueTotal',
  'shopifyUnitsTotal',
  'clicks',
  'impressions',
  'ctr',
  'cpc',
  'cpm',
] as const;

const EMPTY: CampaignsColumnPrefs = {
  hidden: [...DEFAULT_HIDDEN_COLUMN_IDS],
  order: undefined,
};

export function readCampaignsColumnPrefs(): CampaignsColumnPrefs {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hidden: [...DEFAULT_HIDDEN_COLUMN_IDS], order: undefined };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    // Tolerate both the canonical shape and a legacy bare array form.
    if (Array.isArray(parsed)) {
      return { hidden: parsed.filter(x => typeof x === 'string') };
    }
    const obj = parsed as { hidden?: unknown; order?: unknown };
    const hidden = Array.isArray(obj.hidden)
      ? obj.hidden.filter((x): x is string => typeof x === 'string')
      : [];
    // Phase 05.7.x — surface the saved order, filtered to strings only.
    // resolveCampaignsColumnOrder merges this list with the canonical
    // REORDERABLE_COLUMN_IDS so unknown / dropped IDs don't break the
    // operator's view (missing IDs get appended in default position).
    const order = Array.isArray(obj.order)
      ? obj.order.filter((x): x is string => typeof x === 'string')
      : undefined;
    return { hidden, order };
  } catch {
    return EMPTY;
  }
}

/**
 * Resolve the effective order of the reorderable metric columns by
 * combining the saved order (if any) with the canonical
 * REORDERABLE_COLUMN_IDS list:
 *   1. Walk the saved order first, keeping only IDs that still exist
 *      in REORDERABLE_COLUMN_IDS (handles schema renames / removals).
 *   2. Append any REORDERABLE_COLUMN_IDS missing from the saved order,
 *      in their default position.
 *
 * Returns the new full list — both the CampaignsTable header and the
 * CampaignsTableRow body iterate this exact list to keep header / cells
 * in lock-step.
 */
export function resolveCampaignsColumnOrder(
  saved: string[] | undefined,
): string[] {
  const canonical = REORDERABLE_COLUMN_IDS as readonly string[];
  if (!saved || saved.length === 0) return [...canonical];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of saved) {
    if (canonical.includes(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of canonical) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * Move a reorderable column one slot up (toward the start) or down
 * (toward the end) in the effective order. Writes the new order back
 * to prefs. No-op when the column is already at the edge in that
 * direction.
 */
export function moveCampaignsColumn(
  id: string,
  direction: 'up' | 'down',
): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const order = resolveCampaignsColumnOrder(cur.order);
  const idx = order.indexOf(id);
  if (idx < 0) return cur;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= order.length) return cur;
  [order[idx], order[target]] = [order[target], order[idx]];
  const next: CampaignsColumnPrefs = { ...cur, order };
  writeCampaignsColumnPrefs(next);
  return next;
}

/** Convenience: reset the reorder back to the canonical default. */
export function resetCampaignsColumnOrder(): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const next: CampaignsColumnPrefs = { ...cur, order: undefined };
  writeCampaignsColumnPrefs(next);
  return next;
}

export function writeCampaignsColumnPrefs(prefs: CampaignsColumnPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    // Stamp the current schema version on every write so the one-time
    // declutter migration (migrateCampaignsColumnPrefs) becomes a no-op
    // after the operator's prefs have been touched at least once.
    const versioned: CampaignsColumnPrefs = { ...prefs, v: CAMPAIGNS_PREFS_VERSION };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(versioned));
    window.dispatchEvent(
      new CustomEvent('roas-campaigns-column-visibility-changed'),
    );
    // Reach into the cloud-sync helper so other devices see the
    // change after the next poll. Same pattern as productMap +
    // campaignOptimized. Push the versioned object so other devices also
    // skip the migration.
    pushCloudKey(STORAGE_KEY, versioned);
  } catch {
    /* quota / private mode — local-only failure, ignore */
  }
}

/**
 * One-time declutter migration (2026-06-01). The lean default-hidden set
 * (`DEFAULT_HIDDEN_COLUMN_IDS`) only reaches a FRESH operator via the
 * read-time seed. An EXISTING operator already has saved prefs in
 * localStorage, so they'd keep seeing every column. This migration runs
 * once on mount: if the saved prefs predate the current schema version, it
 * UNIONS the new default-hidden columns into the operator's `hidden` set
 * (their own hidden columns + their saved order are preserved) and stamps
 * the current version so it never runs again. The operator can still
 * re-show any column from the "עמודות" menu afterward.
 *
 * No-op when: SSR, no saved prefs (fresh → read seed already applies), or
 * the prefs are already at the current version.
 */
export function migrateCampaignsColumnPrefs(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return; // fresh operator — read() already seeds the lean default
    let version: unknown;
    try {
      const parsed = JSON.parse(raw);
      version =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { v?: unknown }).v
          : undefined;
    } catch {
      return; // unparseable — leave it; read() falls back to EMPTY
    }
    if (version === CAMPAIGNS_PREFS_VERSION) return; // already migrated
    const cur = readCampaignsColumnPrefs();
    const hidden = Array.from(
      new Set([...cur.hidden, ...DEFAULT_HIDDEN_COLUMN_IDS]),
    ).sort();
    writeCampaignsColumnPrefs({ ...cur, hidden });
  } catch {
    /* ignore — migration is best-effort */
  }
}

/**
 * Convenience: toggle a single column ID's hidden state.
 *
 * HIGH-4 audit fix (2026-05-23): spread `...cur` into the next prefs
 * object so the operator's user-set `order` (set via
 * `moveCampaignsColumn`) is preserved across hide/show toggles. Pre-fix
 * code constructed `{hidden: [...]}` without copying `order`, silently
 * resetting the saved column order to the canonical default every time
 * the operator hid or restored a column.
 */
export function toggleCampaignsColumnHidden(id: string): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const set = new Set(cur.hidden);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  const next: CampaignsColumnPrefs = { ...cur, hidden: Array.from(set).sort() };
  writeCampaignsColumnPrefs(next);
  return next;
}

/**
 * Convenience: restore all columns (clear the hidden list).
 *
 * HIGH-4 audit fix (2026-05-23): spread `...cur` so the user-set `order`
 * survives the "show everything" action. Pre-fix code wiped the order
 * as a side effect — operators reported reordering ROAS → spend → ...
 * then clicking "restore all" and losing the reorder.
 *
 * If the operator explicitly wants to reset the order too, they call
 * `resetCampaignsColumnOrder` (a separate, intentional action).
 */
export function restoreAllCampaignsColumns(): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const next: CampaignsColumnPrefs = { ...cur, hidden: [] };
  writeCampaignsColumnPrefs(next);
  return next;
}

/**
 * Reset to the recommended "lean" DEFAULT VIEW (2026-06-01): the
 * default-hidden column set + the canonical column order. Unlike
 * `restoreAllCampaignsColumns` (which shows EVERY column) this snaps the
 * table back to the decluttered default an operator gets out of the box —
 * the explicit, discoverable counterpart to the one-time migration.
 */
export function resetCampaignsColumnsToDefault(): CampaignsColumnPrefs {
  const next: CampaignsColumnPrefs = {
    hidden: [...DEFAULT_HIDDEN_COLUMN_IDS].sort(),
    order: undefined,
  };
  writeCampaignsColumnPrefs(next);
  return next;
}

/**
 * Build a CSS string that hides the cells matching the hidden IDs.
 * Returns an empty string when nothing is hidden — the caller injects
 * the result via a `<style>` tag so the rules only apply inside the
 * scoping selector (the Campaigns table).
 *
 * Why a generated stylesheet instead of `style={{display: 'none'}}` per
 * cell: keeps the row markup unchanged (no per-cell conditional logic),
 * works equally well on <th> + <td>, and lets the browser handle the
 * relayout in one pass.
 *
 * Selector format mirrors the data attribute used in the table JSX:
 *   [data-col-id="<id>"] { display: none; }
 *
 * Scoped to `.roas-campaigns-table` (a class added to the surrounding
 * <div>) so the same data-col-id literals in other tables aren't
 * affected accidentally.
 */
export function buildHiddenColumnsCss(hidden: string[]): string {
  if (!hidden || hidden.length === 0) return '';
  const safe = hidden
    .filter(id => /^[a-zA-Z0-9_-]+$/.test(id))
    .map(id => `.roas-campaigns-table [data-col-id="${id}"]`);
  if (safe.length === 0) return '';
  return `${safe.join(', ')} { display: none !important; }`;
}

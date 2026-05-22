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
  { id: 'roasShopify', label: 'ROAS Shopify (כללי)', description: 'ROAS בפועל לפי מיפוי + fallback פרופורציונלי' },
  { id: 'roasShopifyPlatform', label: 'ROAS Shopify · פלטפורמה', description: 'ROAS מבוסס רק על הזמנות שסווגו ב-Shopify לפלטפורמה הזו (דטרמיניסטי בלבד, ללא fallback)' },
  { id: 'shopifyValuePlatform', label: 'ערך Shopify · פלטפורמה', description: 'מהזמנות שסווגו לפלטפורמה הזו (source/click-id)' },
  { id: 'shopifyUnitsPlatform', label: 'יח׳ Shopify · פלטפורמה', description: 'יחידות מהזמנות שסווגו לפלטפורמה הזו' },
  { id: 'shopifyValueTotal', label: 'ערך Shopify · סה"כ', description: 'סך מכירות המוצרים הממופים בכל הפלטפורמות' },
  { id: 'shopifyUnitsTotal', label: 'יח׳ Shopify · סה"כ', description: 'סך היחידות שנמכרו של המוצרים הממופים' },
  { id: 'conversions', label: 'המרות', description: 'מספר ההמרות שדיווחה הפלטפורמה' },
  { id: 'ctr', label: 'CTR', description: 'קליקים/חשיפות' },
  { id: 'cpc', label: 'CPC', description: 'עלות לקליק' },
  { id: 'cpm', label: 'CPM', description: 'עלות ל-1000 חשיפות' },
  { id: 'cpa', label: 'CPA', description: 'עלות להמרה' },
  { id: 'deepLink', label: 'קישור ל-Ads Manager', pinned: true },
];

export type CampaignsColumnId = (typeof CAMPAIGNS_COLUMNS)[number]['id'];

export type CampaignsColumnPrefs = {
  hidden: string[];
};

const EMPTY: CampaignsColumnPrefs = { hidden: [] };

export function readCampaignsColumnPrefs(): CampaignsColumnPrefs {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    // Tolerate both the canonical shape and a legacy bare array form.
    if (Array.isArray(parsed)) {
      return { hidden: parsed.filter(x => typeof x === 'string') };
    }
    if (Array.isArray((parsed as { hidden?: unknown }).hidden)) {
      return {
        hidden: ((parsed as { hidden: unknown[] }).hidden).filter(
          (x): x is string => typeof x === 'string',
        ),
      };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

export function writeCampaignsColumnPrefs(prefs: CampaignsColumnPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(
      new CustomEvent('roas-campaigns-column-visibility-changed'),
    );
    // Reach into the cloud-sync helper so other devices see the
    // change after the next poll. Same pattern as productMap +
    // campaignOptimized.
    pushCloudKey(STORAGE_KEY, prefs);
  } catch {
    /* quota / private mode — local-only failure, ignore */
  }
}

/** Convenience: toggle a single column ID's hidden state. */
export function toggleCampaignsColumnHidden(id: string): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const set = new Set(cur.hidden);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  const next: CampaignsColumnPrefs = { hidden: Array.from(set).sort() };
  writeCampaignsColumnPrefs(next);
  return next;
}

/** Convenience: restore all columns (clear the hidden list). */
export function restoreAllCampaignsColumns(): CampaignsColumnPrefs {
  const next: CampaignsColumnPrefs = { hidden: [] };
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

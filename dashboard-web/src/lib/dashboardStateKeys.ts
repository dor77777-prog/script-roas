/**
 * Dashboard-state key allowlist — shared validator at the API boundary.
 *
 * Used by:
 *   - `/api/dashboard-state` POST route: rejects arbitrary keys before they
 *     reach `upsertDashboardStateKeyPostgres`. Without this, a client could
 *     write a row with key="__proto__" or "constructor" → on the next
 *     `fetchDashboardStateFromPostgres`, the line `kv[key] = parsed` would
 *     set Object.prototype properties — affecting every object in the
 *     Node.js process until restart.
 *
 *   - `fetchDashboardStateFromPostgres` additionally uses `Object.create(null)`
 *     so even keys that bypass this check (e.g. a row written directly to
 *     Supabase by ops) cannot pollute the prototype. Belt + suspenders.
 *
 * Keep this list in sync with `cloudSync.ts:STATE_KEYS`. The two cannot
 * share the same array because `cloudSync.ts` is browser-side code (uses
 * `window` + `localStorage`); importing it from this server-safe module
 * would bundle in client-only references on the server.
 *
 * Relocated from `lib/sheets.ts` in Phase 11 (Apps Script decommission) —
 * sheets.ts was the last surviving owner of this allowlist and the only
 * reason the route imported a Sheets-named module after Phase 05.7.
 */
export const ALLOWED_STATE_KEYS = [
  'billing-recurring',
  'billing-onetime',
  'annotations',
  'monthly-revenue-goal',
  'insight-states',
  'campaign-optimized',
  'campaign-product-map',
  'campaigns-column-visibility',
  'campaign-store-map',
] as const;

export type AllowedStateKey = (typeof ALLOWED_STATE_KEYS)[number];

export function isAllowedStateKey(k: unknown): k is AllowedStateKey {
  return typeof k === 'string' && (ALLOWED_STATE_KEYS as readonly string[]).includes(k);
}

// dashboard-web/src/lib/operatorReset.ts
//
// Phase 05.7.1 — shared constants + validator for the operator "Reset
// Data" endpoint. Imported by:
//   - dashboard-web/src/app/api/operator/reset/route.ts  (server)
//   - dashboard-web/src/components/operator/ResetData.tsx (client)
//
// Why a shared module rather than copy-pasting the literals on both
// sides:
//   The confirmation tokens are paired with their scopes — a typo on
//   either side breaks the contract. A single source of truth (this
//   module) means the operator-typed literal is verified character-
//   for-character against the server-side comparison, with no drift.
//
// SECURITY: this module is purely pure (no env vars, no clients, no DB
// access). It is safe to import from both server route handlers and
// client components — no `getSupabaseAdmin` reaches the client bundle
// through this file.

export const DATA_TABLES = [
  // Phase 05.5 data tables that backfill regenerates. Order doesn't
  // matter for deletion semantics — none of these FK to each other,
  // they only FK to `stores(id)`, which we never touch. Listed in the
  // same logical grouping as the 10-table CONTEXT.md narrative.
  'data_daily',
  'products_daily',
  'campaigns_daily',
  'ads_daily',
  'orders_attribution',
  'product_catalog',
  'manual_overrides',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

// `except-manual` scope skips manual_overrides. The list is materialized
// (rather than computed from DATA_TABLES.slice) so a future change to
// either array is visible in a diff — important because these arrays
// are part of the "blast radius" contract.
export const EXCEPT_MANUAL_TABLES = [
  'data_daily',
  'products_daily',
  'campaigns_daily',
  'ads_daily',
  'orders_attribution',
  'product_catalog',
] as const satisfies readonly DataTable[];

// Tables that the reset endpoint MUST NEVER touch — listed here as
// documentation + a unit-testable assertion (the test file checks
// that none of these appear in DATA_TABLES). Wiping any of these
// would destroy:
//   - stores: the 3-store seeded config (Phase 05.5)
//   - notification_config: 2 provider rows (Phase 05.5)
//   - dashboard_state: the operator's UI prefs (annotations, billing
//     recurring/onetime, monthly revenue goal, campaign-product-map,
//     campaign-optimized, insight-states — Phase 05.5 D-A5 row 9 +
//     ALLOWED_STATE_KEYS in sheets.ts)
export const PROTECTED_TABLES = [
  'stores',
  'notification_config',
  'dashboard_state',
] as const;

export type ResetScope = 'all' | 'except-manual';

// Defense-in-depth confirmation tokens. The UI requires the operator to
// type these literally into a text input before the confirm button is
// enabled; the server then re-verifies on the request body. Both
// layers must hold for a destructive delete to land.
export const CONFIRM_TOKEN_ALL = 'YES-DELETE-ALL-DATA';
export const CONFIRM_TOKEN_EXCEPT_MANUAL = 'YES-DELETE-EXCEPT-MANUAL';

// Map from scope → required confirm token. Single source of truth used
// by both the validator (server) and the modal (client).
export const CONFIRM_TOKEN_FOR_SCOPE: Record<ResetScope, string> = {
  all: CONFIRM_TOKEN_ALL,
  'except-manual': CONFIRM_TOKEN_EXCEPT_MANUAL,
};

export type ResetBody = {
  scope: ResetScope;
  confirm: string;
};

/**
 * Validate a parsed JSON request body for /api/operator/reset.
 *
 * Returns the typed ResetBody on success, or a human-readable error
 * string on failure. The string form is rendered verbatim in the
 * operator UI — keep it ASCII-safe.
 *
 * Two error gates:
 *   1. Shape — scope must be one of the two literals
 *   2. Confirm — the confirm field must match the token for that scope
 *
 * Both checks are independent so the response message tells the
 * operator exactly which gate they tripped (rather than a generic
 * "invalid body").
 */
export function validateResetBody(raw: unknown): ResetBody | string {
  if (!raw || typeof raw !== 'object') {
    return 'body must be a JSON object';
  }
  const b = raw as Record<string, unknown>;
  const scope = b.scope;
  if (scope !== 'all' && scope !== 'except-manual') {
    return "scope must be 'all' or 'except-manual'";
  }
  const required = CONFIRM_TOKEN_FOR_SCOPE[scope];
  if (typeof b.confirm !== 'string' || b.confirm !== required) {
    // Don't echo the required token in the error — that would defeat
    // the literal-typing friction. The UI knows the correct value
    // because it's imported from this same module.
    return `confirm token missing or incorrect for scope=${scope}`;
  }
  return { scope, confirm: b.confirm };
}

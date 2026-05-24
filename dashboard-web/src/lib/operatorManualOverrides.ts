// dashboard-web/src/lib/operatorManualOverrides.ts
//
// Pure validation helpers for /api/operator/manual-overrides extracted
// out of the Next.js route handler so they can be `export`ed without
// tripping Next 14's generated OmitWithTag<typeof routeModule, GET |
// POST | ...> constraint (Next forbids non-HTTP-verb exports on
// app/**/route.ts modules).
//
// AUDIT API-26 (2026-05-24, Phase 12.3): parseStrictNumeric closes the
// parseFloat('1500NIS') → 1500 silent-truncation bug. validatePost is
// the POST request-body validator; the PATCH handler reuses
// parseStrictNumeric for its own spend branch.
//
// This module is server-safe (no React, no DOM, no env vars).

import { isDate } from '@/lib/dateValidation';

export const VALID_STORES = new Set(['uzoshop', 'zolplus', 'usmile360']);
export const VALID_PLATFORMS = new Set(['meta', 'google']);
export const VALID_CURRENCIES = new Set(['ILS', 'CAD', 'USD']);

export type PostBody = {
  date: string;
  store_id: string;
  platform: string;
  spend: number;
  currency: string;
  notes?: string | null;
};

// AUDIT API-26 (2026-05-24, Phase 12.3): strict numeric coercion.
// parseFloat('1500NIS') returns 1500 (silently truncates trailing
// garbage); Number('1500NIS') returns NaN. Combined with a regex
// pre-check on string inputs we reject anything that isn't a clean
// signed decimal. Numbers pass through unchanged for backward compat
// with callers that already typed b.spend as number.
// Evidence: .planning/phases/12-codebase-audit-baseline/raw-returns/
//   api_operator_manualOverrides.json (API-26).
export function parseStrictNumeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return NaN;
  return Number(value);
}

/**
 * Validate + normalise a POST body. Returns the normalised body on
 * success, or a human-readable error string on failure.
 */
export function validatePost(body: unknown): PostBody | string {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (!isDate(b.date)) return 'date must be YYYY-MM-DD';
  if (typeof b.store_id !== 'string' || !VALID_STORES.has(b.store_id)) {
    return `unknown store_id: ${String(b.store_id)}`;
  }
  const platform = String(b.platform ?? '').toLowerCase();
  if (!VALID_PLATFORMS.has(platform)) {
    return "platform must be 'meta' or 'google'";
  }
  const currency = String(b.currency ?? '').toUpperCase();
  if (!VALID_CURRENCIES.has(currency)) {
    return 'currency must be ILS/CAD/USD';
  }
  const spend = parseStrictNumeric(b.spend);
  if (!Number.isFinite(spend)) return 'spend must be numeric';
  const notes = b.notes === undefined || b.notes === null ? null : String(b.notes);
  return {
    date: b.date,
    store_id: b.store_id,
    platform,
    spend,
    currency,
    notes,
  };
}

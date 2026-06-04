// dashboard-web/src/lib/home/overridesActive.ts
//
// overrides-active (DQ-3) — answer one question for the Home/data-quality
// surface: are any operator-typed manual spend overrides ACTIVE in the
// currently-selected date range, and if so, which store×platform combos do
// they cover (with a count, the most-recent note, and the last-edited time)?
//
// WHY this exists: a `manual_overrides` row REPLACES the fetched spend for its
// (date, store_id, platform) (see lib/fetchers/manualOverrides.ts). When the
// operator is staring at a number, "is this real fetched data or a hand-typed
// override?" is a data-quality question. This helper summarises that for the
// visible range so the UI can badge it (e.g. "מחיר ידני" / manual-spend flag).
//
// MAPPING-AWARE projection: rows are grouped by the store DISPLAY name (via the
// canonical STORE_ID_TO_NAME map) so the key matches what the rest of the Home
// surface keys per-store buckets on (display name, NOT raw store_id).
//
// PURE + read-only: deterministic, no network/DB/React. Imports types/maps
// READ-ONLY. CAPI-safe by construction (no pixel/CAPI events).

import type { DateRange } from '@/lib/dateRange';
import { STORE_ID_TO_NAME } from '@/lib/platformsByStore';

/**
 * A `manual_overrides` row AS READ from Supabase.
 *
 * Table shape (supabase/migrations/20260521063112_initial_schema.sql):
 *   id BIGSERIAL, date DATE, store_id TEXT, platform TEXT,
 *   spend NUMERIC(14,4), currency TEXT, notes TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(date, store_id, platform).
 *
 * `updated_at` and `applies_to` are forward-compat fields: they are NOT in the
 * current migration, so they are typed OPTIONAL. When `updated_at` is present
 * it is preferred over `created_at` for the "last edited" timestamp; the helper
 * degrades gracefully to `created_at` when it is absent. `spend` may decode as
 * `number` or `string` depending on column precision (mirrors OverrideRow in
 * lib/fetchers/manualOverrides.ts) — it is not read here but kept for fidelity.
 */
export type OverrideRowAsRead = {
  id: number;
  date: string; // YYYY-MM-DD
  store_id: string;
  platform: string; // CHECK-constrained to 'meta' | 'google' | 'tiktok' at the DB
  spend: number | string; // NUMERIC(14,4) — may decode as number or string
  currency: string;
  notes: string | null;
  created_at: string; // ISO timestamp
  /** Forward-compat: present once the table gains an updated-on-edit column. */
  updated_at?: string | null;
  /** Forward-compat: present once the table gains a row-scope column. */
  applies_to?: string | null;
};

/** One active-override group: count + most-recent note + latest edit time. */
export type OverridesActiveGroup = {
  count: number;
  note?: string;
  lastEditedAt?: string;
};

export type OverridesActiveResult = {
  anyActive: boolean;
  byStorePlatform: Record<string, OverridesActiveGroup>;
};

/** Display name for a raw store_id (canonical map; raw id fallback). */
function displayStore(storeId: string): string {
  return (STORE_ID_TO_NAME as Record<string, string>)[storeId] ?? storeId;
}

/** Last-edited timestamp for a row: updated_at if present, else created_at. */
function lastEditedOf(row: OverrideRowAsRead): string {
  return row.updated_at ?? row.created_at;
}

/**
 * Summarise the manual overrides that are ACTIVE within [range.from, range.to]
 * (both bounds inclusive — a row whose `date` equals a bound counts).
 *
 * Comparison is lexicographic on YYYY-MM-DD strings, which is correct for
 * zero-padded ISO calendar dates (no Date parsing → no timezone drift).
 *
 * Grouping key: `${displayStore(store_id)}::${platform}`. Within a group:
 *   - count        = number of active rows.
 *   - note         = the note of the most-recent row that HAS a non-empty note
 *                    (rows without a note are skipped for note selection).
 *   - lastEditedAt = the latest updated_at/created_at across all active rows.
 *
 * anyActive is true iff at least one row falls inside the range.
 */
export function overridesActive(
  rows: readonly OverrideRowAsRead[],
  range: DateRange,
): OverridesActiveResult {
  const byStorePlatform: Record<string, OverridesActiveGroup> = {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return { anyActive: false, byStorePlatform };
  }

  const { from, to } = range;

  // Per-group bookkeeping for choosing the most-recent note independently from
  // the most-recent edit time (a newer row may have a null note).
  const noteWinnerAt: Record<string, string> = {};

  for (const row of rows) {
    if (!row || typeof row.date !== 'string') continue;
    // Inclusive range check via lexicographic compare on YYYY-MM-DD.
    if (row.date < from || row.date > to) continue;

    const key = `${displayStore(row.store_id)}::${row.platform}`;
    const editedAt = lastEditedOf(row);

    const existing = byStorePlatform[key];
    if (!existing) {
      byStorePlatform[key] = { count: 1, lastEditedAt: editedAt };
    } else {
      existing.count += 1;
      if (existing.lastEditedAt === undefined || editedAt > existing.lastEditedAt) {
        existing.lastEditedAt = editedAt;
      }
    }

    // Most-recent NON-EMPTY note wins (tracked separately from lastEditedAt).
    const note = typeof row.notes === 'string' ? row.notes.trim() : '';
    if (note.length > 0) {
      const prevAt = noteWinnerAt[key];
      if (prevAt === undefined || editedAt >= prevAt) {
        noteWinnerAt[key] = editedAt;
        byStorePlatform[key].note = note;
      }
    }
  }

  return { anyActive: Object.keys(byStorePlatform).length > 0, byStorePlatform };
}

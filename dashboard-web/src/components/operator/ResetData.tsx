'use client';

// dashboard-web/src/components/operator/ResetData.tsx
//
// Phase 05.7.1 — operator "Reset Data" destructive panel.
//
// Two buttons + a confirmation modal that wipe Supabase data tables via
// POST /api/operator/reset. The operator uses this to re-run backfill
// from a known-empty state and verify the dashboard end-to-end.
//
// === Why two-step confirmation (button → modal → typed literal) ===
//
// URL-obscurity is the entire auth posture (Phase 05.5 D-D2). Without
// any friction, a Cmd+Shift+R that restores scroll position into a
// click target — or a partner glancing at the URL while you step away —
// can wipe the data set. The modal+typed-token pattern mirrors GitHub's
// "type the repo name to confirm delete" UX: the operator must type a
// specific literal that names the action, character by character. This
// is the same defense ManualOverridesCrud uses for single-row delete
// (per its file-level comment) but turned up because the blast radius
// is now "every data row across 7 tables", not "one manual-overrides
// row".
//
// === Why two scopes with different tokens ===
//
// The token text encodes the scope (YES-DELETE-ALL-DATA vs
// YES-DELETE-EXCEPT-MANUAL). Even if the operator mis-clicks the wrong
// button, they cannot accidentally complete the wrong action — the
// modal asks them to type a token that names the scope, and the server
// rejects mismatches. Two tokens (instead of one shared "I CONFIRM")
// is the cheapest way to make "I meant to keep manual_overrides" and
// "I meant to delete manual_overrides too" non-interchangeable.
//
// === Why match ManualOverridesCrud's modal pattern ===
//
// Style consistency (D-D4) — a partner using the operator console
// shouldn't see two different "confirm delete" UX paradigms on the
// same page. Same Tailwind tokens, same z-50 overlay, same RTL layout,
// same role=dialog + aria-labelledby + aria-modal=true a11y hooks.
//
// === Why mutate() on neighbouring SWR keys after success ===
//
// After a wipe, the JobsTable's data is now stale (no new jobs will
// fire until the operator triggers a backfill) but the ManualOverrides
// CRUD list is *definitely* stale (we just dropped its rows in the
// 'all' scope). We call SWR's global mutate() on those two keys so
// the operator sees the empty state immediately without waiting for
// the 15s poll tick.
//
// SECURITY: this file intentionally has no direct database client
// access. Every Supabase verb goes through the server-only route at
// /api/operator/reset — no service_role / supabaseAdmin module is
// importable here. The shared @/lib/operatorReset module is pure
// constants + a validator, no env vars or clients.

import { useState } from 'react';
import { mutate } from 'swr';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import {
  CONFIRM_TOKEN_FOR_SCOPE,
  PROTECTED_TABLES,
  type ResetScope,
} from '@/lib/operatorReset';
import { operatorFetch } from '@/lib/operatorClient';

// Wire-shape of the /api/operator/reset 200 response. Mirrored locally
// rather than imported across the server/client boundary to keep the
// boundary inspectable in the network panel (same pattern as
// SyncNowButtons' SyncResponse type).
type ResetResponse = {
  scope: ResetScope;
  deleted: Record<string, number>;
  errors?: Record<string, string>;
  total: number;
  durationMs: number;
};

// Per-scope UI descriptor — drives the button label, the modal
// heading, and the list of tables shown to the operator. Keeping this
// declarative means the only "behaviour" difference between the two
// modes is which descriptor we picked.
type ScopeDescriptor = {
  scope: ResetScope;
  buttonLabel: string;
  buttonClass: string;
  modalTitle: string;
  modalWarning: string;
  tablesShown: readonly string[];
  preserves?: string;
};

// Tailwind class strings rather than tokens because the operator
// console doesn't yet have a "destructive/orange" token in
// tailwind.config — match the inline red/orange used in
// ManualOverridesCrud's delete button instead.
const SCOPE_ALL: ScopeDescriptor = {
  scope: 'all',
  buttonLabel: 'איפוס מלא — מחק את כל הנתונים כולל הוצאות ידניות',
  buttonClass: 'bg-red-600 hover:bg-red-500 disabled:bg-red-800',
  modalTitle: 'איפוס מלא של כל הנתונים',
  modalWarning:
    'פעולה זו תמחק את כל נתוני הדשבורד, כולל ההוצאות הידניות שהוזנו ידנית. אין צעד אחורה.',
  tablesShown: [
    'data_daily',
    'products_daily',
    'campaigns_daily',
    'ads_daily',
    'orders_attribution',
    'product_catalog',
    'manual_overrides',
  ],
};

const SCOPE_EXCEPT_MANUAL: ScopeDescriptor = {
  scope: 'except-manual',
  buttonLabel: 'איפוס חלקי — מחק הכל פרט להוצאות ידניות',
  buttonClass: 'bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800',
  modalTitle: 'איפוס חלקי — מחק הכל פרט להוצאות ידניות',
  modalWarning:
    'פעולה זו תמחק את נתוני ה-fetch (Shopify / Meta / Google / מוצרים / קמפיינים), אך תשמור על טבלת manual_overrides. ניתן לרוץ backfill מחדש.',
  tablesShown: [
    'data_daily',
    'products_daily',
    'campaigns_daily',
    'ads_daily',
    'orders_attribution',
    'product_catalog',
  ],
  preserves: 'manual_overrides',
};

export function ResetData() {
  // null = no modal open. The selected descriptor drives the modal
  // content (labels, table list, expected token) — there's no shared
  // "is modal open" state separate from "which scope is this modal
  // for", because a modal without a scope is meaningless.
  const [active, setActive] = useState<ScopeDescriptor | null>(null);
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ResetResponse | null>(null);

  const openModal = (descriptor: ScopeDescriptor) => {
    setActive(descriptor);
    setTyped('');
    setError(null);
  };

  const closeModal = () => {
    if (submitting) return; // don't close mid-flight
    setActive(null);
    setTyped('');
    setError(null);
  };

  const submit = async () => {
    if (!active) return;
    const required = CONFIRM_TOKEN_FOR_SCOPE[active.scope];
    if (typed !== required) {
      // Belt-and-braces — the button is disabled when typed !==
      // required, but if a future Enter-key handler bypasses the
      // disabled state, this prevents the destructive call.
      setError('יש להקליד את הטוקן בדיוק כפי שמוצג למעלה.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await operatorFetch('/api/operator/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: active.scope, confirm: required }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | ResetResponse
        | { error?: string };
      if (res.status >= 400) {
        throw new Error(
          ('error' in body && body.error) || `HTTP ${res.status}`,
        );
      }
      const ok = body as ResetResponse;
      setLastResult(ok);
      // Refresh the two SWR caches the operator is most likely to be
      // staring at after a reset — manual_overrides list (it's empty
      // now in scope=all) and jobs table (latest runs are now
      // historical context, no current activity). Other readers
      // (Dashboard tabs) catch up on their own poll cycles.
      void mutate('/api/operator/manual-overrides');
      void mutate('/api/operator/jobs');
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[SCOPE_ALL, SCOPE_EXCEPT_MANUAL].map((d) => (
          <button
            key={d.scope}
            type="button"
            onClick={() => openModal(d)}
            disabled={submitting}
            className={`flex items-center gap-2 text-white text-sm px-3 py-2 rounded disabled:cursor-not-allowed ${d.buttonClass}`}
          >
            <AlertTriangle className="w-4 h-4" />
            {d.buttonLabel}
          </button>
        ))}
      </div>

      {lastResult && (
        // Inline success feedback (Hebrew, role=status for a11y).
        // Lists per-table counts so the operator sees what landed —
        // a non-zero value here is the "yes, this actually wiped"
        // confirmation that no toast library is needed for.
        <div
          role="status"
          className="rounded border border-green-500/30 bg-green-500/10 p-3 text-sm space-y-1"
        >
          <p className="text-green-300 font-semibold">
            איפוס הושלם ({lastResult.scope === 'all' ? 'מלא' : 'חלקי'}) —
            סה״כ {lastResult.total} שורות נמחקו (
            <span dir="ltr">{lastResult.durationMs}ms</span>).
          </p>
          <ul className="text-text-secondary text-xs space-y-0.5">
            {Object.entries(lastResult.deleted).map(([table, count]) => (
              <li key={table} dir="ltr">
                <code>{table}</code>:{' '}
                {count >= 0 ? (
                  <span>{count} rows</span>
                ) : (
                  <span className="text-red-400">failed</span>
                )}
              </li>
            ))}
          </ul>
          {lastResult.errors && (
            <p className="text-amber-300 text-xs">
              חלק מהטבלאות נכשלו — ראה פירוט מעל. ייתכן שצריך לרוץ שוב.
            </p>
          )}
        </div>
      )}

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-confirm-title"
        >
          <div className="bg-background border border-white/10 rounded p-4 max-w-md w-full mx-4">
            <div className="flex items-start justify-between mb-3">
              <h3
                id="reset-confirm-title"
                className="text-lg font-semibold flex items-center gap-2"
              >
                <AlertTriangle className="w-5 h-5 text-red-400" />
                {active.modalTitle}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                aria-label="סגור"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm mb-3">{active.modalWarning}</p>

            <div className="mb-3">
              <p className="text-text-secondary text-xs mb-1">
                טבלאות שיימחקו:
              </p>
              <ul className="text-xs space-y-0.5">
                {active.tablesShown.map((t) => (
                  <li key={t} dir="ltr">
                    <code className="text-red-400">{t}</code>
                  </li>
                ))}
              </ul>
              <p className="text-text-secondary text-xs mt-3 mb-1">
                טבלאות שתמיד מוגנות (לעולם לא נמחקות):
              </p>
              <ul className="text-xs space-y-0.5">
                {PROTECTED_TABLES.map((t) => (
                  <li key={t} dir="ltr">
                    <code className="text-green-400">{t}</code>
                    {t === 'stores' && (
                      <span className="text-text-secondary" dir="rtl">
                        {' '}— 3 החנויות שלך
                      </span>
                    )}
                    {t === 'notification_config' && (
                      <span className="text-text-secondary" dir="rtl">
                        {' '}— הגדרות התראות (לא נמשך מ-API)
                      </span>
                    )}
                    {t === 'dashboard_state' && (
                      <span className="text-text-secondary" dir="rtl">
                        {' '}— הגדרות UI (annotations, billing, monthly goal, product mapping)
                      </span>
                    )}
                  </li>
                ))}
                {active.preserves && (
                  <li dir="ltr">
                    <code className="text-green-400">{active.preserves}</code>
                    <span className="text-text-secondary" dir="rtl">
                      {' '}— הוצאות ידניות (במצב חלקי)
                    </span>
                  </li>
                )}
              </ul>
            </div>

            <label className="block mb-2">
              <span className="text-xs text-text-secondary block mb-1">
                הקלד את הטוקן הבא בדיוק כדי לאשר:
              </span>
              <code
                className="block bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-amber-300 mb-2"
                dir="ltr"
              >
                {CONFIRM_TOKEN_FOR_SCOPE[active.scope]}
              </code>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-foreground"
                dir="ltr"
                placeholder="הקלד כאן…"
                autoFocus
                disabled={submitting}
              />
            </label>

            {error && (
              <p className="text-red-400 text-sm mb-3" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white text-sm px-3 py-1 rounded"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={
                  submitting ||
                  typed !== CONFIRM_TOKEN_FOR_SCOPE[active.scope]
                }
                className="flex items-center gap-1 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:cursor-not-allowed text-white text-sm px-3 py-1 rounded"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'מוחק…' : 'אשר ומחק'}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-text-secondary text-xs">
        * הפעולה משתמשת ב-service_role של Supabase (server-side). הקריאה
        ל-API מסתיימת רק לאחר ש-DELETE הסתיים — אין asynchronous queue.
      </p>
    </div>
  );
}

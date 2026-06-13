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
// same page. Both confirms now route through the SHARED Radix `Sheet`
// primitive (variant="modal") — NEVER a hand-rolled fixed-overlay div,
// which would be inert if ever opened over another Sheet (the
// modal-over-Sheet rule). The Sheet gives focus-trap + scroll-lock +
// Esc + role=dialog + aria-modal/aria-labelledby/aria-describedby for
// free; the destructive emphasis is carried by the semantic Button
// variants (destructive = full wipe, warning = partial wipe).
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
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  CONFIRM_TOKEN_FOR_SCOPE,
  PROTECTED_TABLES,
  type ResetScope,
} from '@/lib/operatorReset';
import { operatorFetch } from '@/lib/operatorClient';
import { Button, type ButtonProps } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet';

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
  /**
   * Semantic Button variant (W7) — the variant OWNS the status colour
   * (destructive = red, warning = orange) + hover/focus/disabled treatment.
   * Replaces the old hand-painted `buttonClass` (bg-status-*Btn repaints).
   */
  buttonVariant: ButtonProps['variant'];
  modalTitle: string;
  modalWarning: string;
  tablesShown: readonly string[];
  preserves?: string;
};

// Per-scope emphasis via semantic Button variants — the full wipe is
// `destructive` (red), the partial wipe `warning` (orange). The variant owns
// the colour, hover, focus-ring, and disabled treatment (token-flat); no
// per-descriptor className repaint.
const SCOPE_ALL: ScopeDescriptor = {
  scope: 'all',
  buttonLabel: 'איפוס מלא — מחק את כל הנתונים כולל הוצאות ידניות',
  buttonVariant: 'destructive',
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
  buttonVariant: 'warning',
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
          <Button
            key={d.scope}
            type="button"
            variant={d.buttonVariant}
            onClick={() => openModal(d)}
            disabled={submitting}
            className="gap-2"
          >
            <AlertTriangle className="w-4 h-4" />
            {d.buttonLabel}
          </Button>
        ))}
      </div>

      {lastResult && (
        // Inline success feedback (Hebrew, role=status for a11y).
        // Lists per-table counts so the operator sees what landed —
        // a non-zero value here is the "yes, this actually wiped"
        // confirmation that no toast library is needed for.
        <div
          role="status"
          className="rounded border border-status-green bg-status-greenBg p-3 text-sm space-y-1"
        >
          <p className="text-status-greenFg font-semibold">
            איפוס הושלם ({lastResult.scope === 'all' ? 'מלא' : 'חלקי'}) —
            סה״כ {lastResult.total} שורות נמחקו (
            <span dir="ltr">{lastResult.durationMs}ms</span>).
          </p>
          <ul className="text-ink-secondary text-xs space-y-0.5">
            {Object.entries(lastResult.deleted).map(([table, count]) => (
              <li key={table} dir="ltr">
                <code>{table}</code>:{' '}
                {count >= 0 ? (
                  <span>{count} rows</span>
                ) : (
                  <span className="text-status-redFg">failed</span>
                )}
              </li>
            ))}
          </ul>
          {lastResult.errors && (
            <p className="text-status-orangeFg text-xs">
              חלק מהטבלאות נכשלו — ראה פירוט מעל. ייתכן שצריך לרוץ שוב.
            </p>
          )}
        </div>
      )}

      {/* Reset-confirm modal — routed through the shared Radix `Sheet`
          primitive (variant="modal"), NEVER a hand-rolled fixed-overlay div
          (the modal-over-Sheet rule). Focus-trap + scroll-lock + Esc +
          role=dialog come for free. The typed-token gate is UNCHANGED: the
          destructive action stays DISABLED until `typed` exactly equals the
          per-scope token. Esc / backdrop are ignored mid-flight (closeModal
          early-returns while submitting). */}
      {active && (
        <Sheet
          open
          onOpenChange={(o) => {
            if (!o) closeModal(); // closeModal early-returns mid-flight
          }}
        >
          <SheetContent variant="modal" dir="rtl" className="sm:max-w-md p-0 gap-0">
            <SheetHeader className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-status-redFg" aria-hidden="true" />
              <div className="min-w-0">
                <SheetTitle className="text-status-redFg">{active.modalTitle}</SheetTitle>
                {/* The destructive warning copy doubles as the dialog's
                    accessible description (aria-describedby) — same copy as
                    before, now wired for a11y. */}
                <SheetDescription className="text-sm text-ink mt-2">
                  {active.modalWarning}
                </SheetDescription>
              </div>
            </SheetHeader>

            <SheetBody className="space-y-3">
              <div>
                <p className="text-ink-secondary text-xs mb-1">
                  טבלאות שיימחקו:
                </p>
                <ul className="text-xs space-y-0.5">
                  {active.tablesShown.map((t) => (
                    <li key={t} dir="ltr">
                      <code className="text-status-redFg">{t}</code>
                    </li>
                  ))}
                </ul>
                <p className="text-ink-secondary text-xs mt-3 mb-1">
                  טבלאות שתמיד מוגנות (לעולם לא נמחקות):
                </p>
                <ul className="text-xs space-y-0.5">
                  {PROTECTED_TABLES.map((t) => (
                    <li key={t} dir="ltr">
                      <code className="text-status-greenFg">{t}</code>
                      {t === 'stores' && (
                        // Copy-truth (2026-06-10 audit P1-26): no count — the
                        // stores TABLE also holds archived rows, so any number
                        // (active count included) would mis-state its contents.
                        <span className="text-ink-secondary" dir="rtl">
                          {' '}— החנויות שלך (כולל מאורכבות)
                        </span>
                      )}
                      {t === 'notification_config' && (
                        <span className="text-ink-secondary" dir="rtl">
                          {' '}— הגדרות התראות (לא נמשך מ-API)
                        </span>
                      )}
                      {t === 'dashboard_state' && (
                        <span className="text-ink-secondary" dir="rtl">
                          {' '}— הגדרות UI (annotations, billing, monthly goal, product mapping)
                        </span>
                      )}
                    </li>
                  ))}
                  {active.preserves && (
                    <li dir="ltr">
                      <code className="text-status-greenFg">{active.preserves}</code>
                      <span className="text-ink-secondary" dir="rtl">
                        {' '}— הוצאות ידניות (במצב חלקי)
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              <label className="block">
                <span className="text-xs text-ink-secondary block mb-1">
                  הקלד את הטוקן הבא בדיוק כדי לאשר:
                </span>
                <code
                  className="block bg-glass-2 border border-glass-edge rounded px-2 py-1 text-xs text-status-orangeFg mb-2"
                  dir="ltr"
                >
                  {CONFIRM_TOKEN_FOR_SCOPE[active.scope]}
                </code>
                <Input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  dir="ltr"
                  placeholder="הקלד כאן…"
                  autoFocus
                  disabled={submitting}
                />
              </label>

              {error && (
                <p className="text-status-redFg text-sm" role="alert">
                  {error}
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={closeModal}
                disabled={submitting}
              >
                ביטול
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={submit}
                // SAFETY GATE (UNCHANGED): disabled until the typed token
                // EXACTLY equals the per-scope confirm token.
                disabled={
                  submitting ||
                  typed !== CONFIRM_TOKEN_FOR_SCOPE[active.scope]
                }
                className="gap-1"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'מוחק…' : 'אשר ומחק'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <p className="text-ink-secondary text-xs">
        * הפעולה משתמשת ב-service_role של Supabase (server-side). הקריאה
        ל-API מסתיימת רק לאחר ש-DELETE הסתיים — אין asynchronous queue.
      </p>
    </div>
  );
}

'use client';

// dashboard-web/src/components/operator/ManualOverridesCrud.tsx
//
// Client component backing the "החלפות הוצאה ידניות" section of /operator.
// CRUD over the manual_overrides table via /api/operator/manual-overrides.
//
// Why this stays small in 05.6:
//   05.6 ships ADD + LIST + DELETE only. PATCH is implemented on the server
//   (route.ts) but the UI doesn't expose inline edit yet — the operator's
//   workflow today is "delete the wrong row + add a new one", and that's
//   strictly less code to ship + verify in this wave. A future plan can add
//   inline edit if the operator's day-to-day load makes deletion-then-add
//   feel heavy.
//
// Why a confirmation modal for DELETE (RESEARCH §Open Question 5):
//   URL-obscurity is our entire auth posture (D-D2). Without a confirm step,
//   a single mis-click on the trash icon — by the operator, by Cmd+Shift+R
//   restoring scroll position into a click target, by a partner navigating
//   the URL — wipes a row that was hand-entered (load-bearing per D-A5).
//   The modal is the minimum-viable safety rail; it's not a substitute for
//   real auth, just a friction-bump on the destructive verb.
//
// Why SWR's automatic refetch + manual mutate:
//   SWR's `mutate()` after each successful add / delete forces the list to
//   reflect the change immediately (no waiting for the 15s revalidation
//   tick that other dashboard surfaces use). The CRUD route is
//   force-dynamic so the refetch always reads fresh from Postgres.
//
// Why platform/currency case-normalisation on submit:
//   Pitfall 7. The server normalises too (defense in depth), but doing it
//   here as well keeps the wire-payload self-evident in the network panel
//   and means a manual `curl -X POST ... -d '{...platform: "Meta"}'` is
//   the only path that ever puts capitalised values on the wire — useful
//   when grepping logs for misuse.
//
// Hebrew + RTL (S-8): all user-facing copy is Hebrew. Direction inherits
// from the parent `<html dir="rtl">` (already set by the dashboard's root
// layout); numeric / date inputs override with `dir="ltr"` so digits read
// naturally left-to-right.
//
// SECURITY: this file intentionally has no direct database client access.
// All Supabase reads/writes go through the server-only route at
// /api/operator/manual-overrides — never a service-role import here.
// The plan's verify step grep-asserts this contract (any literal mention
// of the admin module name would trip a false positive there).

import useSWR from 'swr';
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';

type Row = {
  id: number;
  date: string;
  store_id: string;
  platform: string;
  spend: number;
  currency: string;
  notes: string | null;
  created_at: string;
};

type ListResponse = {
  rows: Row[];
  error?: string;
};

// Source of truth for the select-option enums. Must match the server-side
// constants in `route.ts` and the Postgres CHECK constraint
// (`manual_overrides_platform_check`). If these diverge, the server
// rejects with a 400 / 400 — visible in the form's error line but not
// surfaced as a runtime crash.
const ALL_STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
const ALL_PLATFORMS = ['meta', 'google'] as const;
const ALL_CURRENCIES = ['ILS', 'CAD', 'USD'] as const;

async function fetcher(url: string): Promise<ListResponse> {
  const res = await operatorFetch(url);
  return (await res.json()) as ListResponse;
}

type FormState = {
  date: string;
  store_id: string;
  platform: string;
  spend: string; // string in the form so the user can type "12." mid-entry
  currency: string;
  notes: string;
};

// Audit fix 2026-05-23 (d/HI-03 companion): use Intl Asia/Jerusalem so
// the form default matches the IL operator's calendar day during early-
// morning sessions (UTC midnight was 1-3 calendar hours BEHIND IL until
// 02:00/03:00 IL time depending on DST). The user can still pick any
// date; this just removes the off-by-one default.
function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function initialForm(): FormState {
  // Default to IL today (operator-friendly). The user picks any date via
  // the date input; this is just an opinionated starting point.
  return {
    date: todayInIsrael(),
    store_id: 'uzoshop',
    platform: 'meta',
    spend: '0',
    currency: 'ILS',
    notes: '',
  };
}

export function ManualOverridesCrud() {
  const { data, error, mutate, isLoading } = useSWR<ListResponse>(
    '/api/operator/manual-overrides',
    fetcher,
  );

  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formState, setFormState] = useState<FormState>(initialForm);
  const [addError, setAddError] = useState<string | null>(null);

  const closeDeleteModal = () => {
    setConfirmDelete(null);
    setDeleteError(null);
  };

  const addRow = async () => {
    setSubmitting(true);
    setAddError(null);
    try {
      const spendNum = parseFloat(formState.spend);
      if (!Number.isFinite(spendNum)) {
        throw new Error('סכום אינו מספרי');
      }
      const res = await operatorFetch('/api/operator/manual-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: formState.date,
          store_id: formState.store_id,
          platform: formState.platform.toLowerCase(),
          spend: spendNum,
          currency: formState.currency.toUpperCase(),
          notes: formState.notes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status >= 400) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
      // Reset just spend + notes so the operator can hammer through several
      // rows for the same date / store / platform without re-picking the
      // common fields. (Common workflow: a single store's missing Meta
      // spend rebuilt across 5-10 dates in one sitting.)
      setFormState((s) => ({ ...s, spend: '0', notes: '' }));
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteRow = async (id: number) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await operatorFetch('/api/operator/manual-overrides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.status >= 400) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await mutate();
      closeDeleteModal();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return <p className="text-ink-secondary text-sm">טוען…</p>;
  }
  if (error) {
    return (
      <p className="text-status-red text-sm">
        שגיאה בטעינת הרשימה: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  // S-2 soft-fail surfaced as amber (non-blocking) — list is empty but the
  // page still renders. Same shape as SyncIndicator's degraded path.
  if (data?.error) {
    return <p className="text-status-orange text-sm">{data.error}</p>;
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      {/* Add-row form — inline so the operator's eye never leaves the table. */}
      <div className="flex flex-wrap items-end gap-2 p-3 bg-elevated2 rounded">
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          תאריך
          <input
            type="date"
            value={formState.date}
            onChange={(e) => setFormState((s) => ({ ...s, date: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm text-ink"
            dir="ltr"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          חנות
          <select
            value={formState.store_id}
            onChange={(e) => setFormState((s) => ({ ...s, store_id: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm text-ink"
          >
            {ALL_STORES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          פלטפורמה
          <select
            value={formState.platform}
            onChange={(e) => setFormState((s) => ({ ...s, platform: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm text-ink"
          >
            {ALL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          סכום
          <input
            type="number"
            step="0.01"
            value={formState.spend}
            onChange={(e) => setFormState((s) => ({ ...s, spend: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm w-24 text-ink"
            dir="ltr"
            placeholder="0.00"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          מטבע
          <select
            value={formState.currency}
            onChange={(e) => setFormState((s) => ({ ...s, currency: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm text-ink"
          >
            {ALL_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1 flex-1 min-w-40">
          הערות
          <input
            type="text"
            value={formState.notes}
            onChange={(e) => setFormState((s) => ({ ...s, notes: e.target.value }))}
            className="bg-canvas border border-line-subtle rounded px-2 py-1 text-sm text-ink"
            placeholder="(אופציונלי)"
          />
        </label>
        <Button
          type="button"
          size="sm"
          onClick={addRow}
          disabled={submitting}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          {submitting ? 'מוסיף…' : 'הוסף'}
        </Button>
      </div>
      {addError && <p className="text-status-red text-sm" role="alert">{addError}</p>}

      {/* Table view */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-ink-secondary text-xs uppercase tracking-wider">
            <tr>
              <th className="text-right p-2">תאריך</th>
              <th className="text-right p-2">חנות</th>
              <th className="text-right p-2">פלטפורמה</th>
              <th className="text-right p-2">סכום</th>
              <th className="text-right p-2">מטבע</th>
              <th className="text-right p-2">הערות</th>
              <th className="text-right p-2">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-center text-ink-secondary text-xs">
                  אין רשומות. הוסף את הראשונה למעלה.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-subtle">
                <td className="p-2" dir="ltr">{r.date}</td>
                <td className="p-2">{r.store_id}</td>
                <td className="p-2">{r.platform}</td>
                <td className="p-2" dir="ltr">{Number(r.spend).toFixed(2)}</td>
                <td className="p-2" dir="ltr">{r.currency}</td>
                <td className="p-2 text-ink-secondary">{r.notes ?? '—'}</td>
                <td className="p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmDelete(r)}
                    aria-label={`מחק שורה ${r.id}`}
                    className="w-8 h-8 text-status-red hover:text-status-red/80 hover:bg-status-redBg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete-confirmation modal (RESEARCH §Open Question 5) */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <div className="bg-elevated border-0 sm:border sm:border-line rounded-none sm:rounded p-4 w-full h-full sm:h-auto sm:max-w-md sm:mx-4 flex flex-col">
            <div className="flex items-start justify-between mb-3 shrink-0">
              <h3 id="confirm-delete-title" className="text-lg font-semibold">
                אישור מחיקה
              </h3>
              <Button
                type="button"
                variant="ghost"
                onClick={closeDeleteModal}
                aria-label="סגור"
                className="w-11 h-11 sm:w-auto sm:h-auto sm:p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto -mx-4 px-4">
              <p className="text-sm mb-3">
                למחוק את ההחלפה הידנית של <strong>{confirmDelete.store_id}</strong> בתאריך{' '}
                <span dir="ltr">{confirmDelete.date}</span> (פלטפורמה {confirmDelete.platform})?
              </p>
              <p className="text-ink-secondary text-xs mb-3">
                סכום: <span dir="ltr">{Number(confirmDelete.spend).toFixed(2)} {confirmDelete.currency}</span>
              </p>
              {deleteError && (
                <p className="text-status-red text-sm mb-3" role="alert">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="sticky bottom-0 bg-elevated pt-2 flex justify-end gap-2 shrink-0 border-t border-line-subtle sm:border-t-0 -mx-4 px-4 sm:mx-0 sm:px-0">
              <Button
                type="button"
                variant="secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
                className="text-sm px-3 py-2 sm:py-1 min-h-[44px] sm:min-h-0 h-auto"
              >
                ביטול
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deleteRow(confirmDelete.id)}
                disabled={deleting}
                className="text-sm px-3 py-2 sm:py-1 min-h-[44px] sm:min-h-0 h-auto"
              >
                {deleting ? 'מוחק…' : 'מחק'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <p className="text-ink-secondary text-xs">
        סה״כ {rows.length} שורות. שינויים נכנסים לתוקף בריצת ה-Inngest הבאה (cron-daily, sync-now, או backfill).
      </p>
      {/* A8-F4 (2026-05-27): the manual_overrides CHECK constraint allows
          only meta|google. TikTok spend cannot be corrected here — this is a
          known schema limitation, not a bug. */}
      <p className="text-ink-secondary text-xs">
        הערה: ניתן לתקן הוצאה ידנית עבור Meta ו-Google בלבד. TikTok אינו נתמך
        כרגע במנגנון התיקונים הידני (מגבלת סכמה).
      </p>
    </div>
  );
}

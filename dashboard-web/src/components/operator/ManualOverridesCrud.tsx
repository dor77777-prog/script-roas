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
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useStores } from '@/lib/useStores';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { TableBase } from '@/components/ui/TableBase';
import { Money } from '@/components/ui/Money';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet';

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
// NOTE: ALL_STORES is now derived from useStores() inside the component.
// TikTok unblock (2026-06-02): the DB CHECK constraint (migration
// 20260522102151) and the server validator (operatorManualOverrides.ts —
// VALID_PLATFORMS) both accept 'tiktok'. The override is CONSUMED end-to-end:
// mergeOverridesFromSupabase (lib/fetchers/manualOverrides.ts) reads the
// tiktok row keyed by store_id and FX-converts it to CAD, and cronDaily
// (chooseTikTokSpendCad in inngest/functions/cronDaily.ts) persists it as the
// authoritative tt_spend_cad for that store. Because the row is keyed by
// store_id, a TikTok override for store X only ever replaces X's mapped TikTok
// spend — never the raw shared account, never another store's split. Surfacing
// it here lets the operator correct TikTok spend when the account errors.
const ALL_PLATFORMS = ['meta', 'google', 'tiktok'] as const;
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

function initialForm(defaultStoreId = 'uzoshop'): FormState {
  // Default to IL today (operator-friendly). The user picks any date via
  // the date input; this is just an opinionated starting point.
  return {
    date: todayInIsrael(),
    store_id: defaultStoreId,
    platform: 'meta',
    spend: '0',
    currency: 'ILS',
    notes: '',
  };
}

export function ManualOverridesCrud() {
  const { stores } = useStores();
  // Derive the active store list from the hook (DB-backed, falls back to the
  // hardcoded 3). The local const keeps the rest of the component unchanged.
  const ALL_STORES = stores;

  // Task 5.2 (UI/UX overhaul) — explicit 15 s refresh + revalidateOnFocus so
  // this panel matches the rest of /operator after the refresh-paradigm
  // unification. Previously this hook ran with SWR defaults (focus-only),
  // which made the panel feel stale relative to JobsTable / TokenFailures.
  const { data, error, mutate, isLoading } = useSWR<ListResponse>(
    '/api/operator/manual-overrides',
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );

  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formState, setFormState] = useState<FormState>(() =>
    initialForm(stores[0]?.storeId ?? 'uzoshop'),
  );
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
      <p className="text-status-redFg text-sm">
        שגיאה בטעינת הרשימה: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  // S-2 soft-fail surfaced as amber (non-blocking) — list is empty but the
  // page still renders. Same shape as SyncIndicator's degraded path.
  if (data?.error) {
    return <p className="text-status-orangeFg text-sm">{data.error}</p>;
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      {/* Add-row form — inline so the operator's eye never leaves the table. */}
      <div className="flex flex-wrap items-end gap-2 p-3 bg-glass-2 rounded">
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          תאריך
          <Input
            type="date"
            value={formState.date}
            onChange={(e) => setFormState((s) => ({ ...s, date: e.target.value }))}
            dir="ltr"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          חנות
          <NativeSelect
            value={formState.store_id}
            onChange={(e) => setFormState((s) => ({ ...s, store_id: e.target.value }))}
          >
            {ALL_STORES.map((s) => (
              <option key={s.storeId} value={s.storeId}>
                {s.storeName}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          פלטפורמה
          <NativeSelect
            value={formState.platform}
            onChange={(e) => setFormState((s) => ({ ...s, platform: e.target.value }))}
          >
            {ALL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          סכום
          <Input
            type="number"
            step="0.01"
            value={formState.spend}
            onChange={(e) => setFormState((s) => ({ ...s, spend: e.target.value }))}
            className="w-24"
            dir="ltr"
            placeholder="0.00"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1">
          מטבע
          <NativeSelect
            value={formState.currency}
            onChange={(e) => setFormState((s) => ({ ...s, currency: e.target.value }))}
          >
            {ALL_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-ink-secondary gap-1 flex-1 min-w-40">
          הערות
          <Input
            type="text"
            value={formState.notes}
            onChange={(e) => setFormState((s) => ({ ...s, notes: e.target.value }))}
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
      {addError && <p className="text-status-redFg text-sm" role="alert">{addError}</p>}

      {/* Table view */}
      <div className="overflow-x-auto">
        <TableBase>
          <thead className="text-ink-secondary text-xs uppercase tracking-wider">
            <tr>
              <th className="text-end p-2">תאריך</th>
              <th className="text-end p-2">חנות</th>
              <th className="text-end p-2">פלטפורמה</th>
              <th className="text-end p-2">סכום</th>
              <th className="text-end p-2">מטבע</th>
              <th className="text-end p-2">הערות</th>
              <th className="text-end p-2">פעולות</th>
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
              <tr key={r.id} className="border-t border-glass-edge">
                <td className="p-2" dir="ltr">{r.date}</td>
                <td className="p-2">{r.store_id}</td>
                <td className="p-2">{r.platform}</td>
                <td className="p-2" dir="ltr">
                  <Money value={Number(r.spend)} prefix="none" decimals={2} />
                </td>
                <td className="p-2" dir="ltr">{r.currency}</td>
                <td className="p-2 text-ink-secondary">{r.notes ?? '—'}</td>
                <td className="p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmDelete(r)}
                    aria-label={`מחק שורה ${r.id}`}
                    className="w-8 h-8 text-status-redFg hover:bg-status-redBg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableBase>
      </div>

      {/* Delete-confirmation modal (RESEARCH §Open Question 5). Routed through
          the shared Radix `Sheet` primitive (variant="modal") — NEVER a
          hand-rolled fixed-overlay div, which would be inert (the
          modal-over-Sheet rule). Focus-trap + scroll-lock + Esc + role=dialog
          come for free. Esc / backdrop are ignored mid-flight (while the DELETE
          request is running). */}
      {confirmDelete && (
        <Sheet
          open
          onOpenChange={(o) => {
            if (!o && !deleting) closeDeleteModal();
          }}
        >
          <SheetContent variant="modal" dir="rtl" className="sm:max-w-md p-0 gap-0">
            <SheetHeader className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-status-redFg" aria-hidden="true" />
              <div className="min-w-0">
                <SheetTitle className="text-status-redFg">אישור מחיקה</SheetTitle>
                <SheetDescription>
                  למחוק את ההחלפה הידנית של <strong>{confirmDelete.store_id}</strong> בתאריך{' '}
                  <span dir="ltr">{confirmDelete.date}</span> (פלטפורמה {confirmDelete.platform})?
                </SheetDescription>
              </div>
            </SheetHeader>

            <SheetBody className="space-y-3">
              <p className="text-ink-secondary text-xs">
                סכום:{' '}
                <span dir="ltr">
                  <Money value={Number(confirmDelete.spend)} prefix="none" decimals={2} />{' '}
                  {confirmDelete.currency}
                </span>
              </p>
              {deleteError && (
                <p className="text-status-redFg text-sm" role="alert">
                  {deleteError}
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                ביטול
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => deleteRow(confirmDelete.id)}
                disabled={deleting}
              >
                {deleting ? 'מוחק…' : 'מחק'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}

      <p className="text-ink-secondary text-xs">
        סה״כ {rows.length} שורות. שינויים נכנסים לתוקף בריצת ה-Inngest הבאה (cron-daily, sync-now, או backfill).
      </p>
      {/* TikTok unblock (2026-06-02): meta | google | tiktok are all
          accepted (DB CHECK migration 20260522102151 + server validator).
          A TikTok override is keyed by store_id and replaces that store's
          mapped TikTok spend only — never the raw shared account. TikTok
          spend is billed in USD, so pick the USD currency for a TikTok row. */}
      <p className="text-ink-secondary text-xs">
        הערה: ניתן לתקן הוצאה ידנית עבור Meta, Google ו-TikTok. הוצאת TikTok
        מחויבת ב-USD — בחר את המטבע USD בשורת TikTok. התיקון חל על ההוצאה
        הממופה של החנות שנבחרה בלבד.
      </p>
    </div>
  );
}

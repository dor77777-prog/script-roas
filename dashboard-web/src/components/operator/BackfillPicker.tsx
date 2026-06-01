'use client';

// dashboard-web/src/components/operator/BackfillPicker.tsx
//
// Phase 05.6 Plan 14 — operator backfill date-range + multi-store picker.
//
// Renders 2 date inputs (from/to) + 3 store checkboxes + a submit button.
// On submit, POSTs to /api/operator/backfill and surfaces the resulting
// 202 + eventIds as a "ה-Backfill נוסף לתור" confirmation. The actual job
// progress is observed in the JobsTable section (plan 13), not here —
// async semantics per D-D4 + RESEARCH §Open Question 4.
//
// === Why 'use client' ===
//
// Three pieces of state (from, to, storeIds Set) + a submit handler that
// reads them, an effect-free render. Server components can't host
// useState; the entire component is interactive. SECURITY: this file
// intentionally has NO supabaseAdmin / NO INNGEST_*_KEY imports — those
// are server-side concerns, and the verify gate greps for their absence
// here.
//
// === Why a Set for storeIds (not an array) ===
//
// O(1) toggle (`.has` / `.delete` / `.add`) keeps the keyboard-fast UX
// the operator wants when toggling all-but-one. We Array.from() at
// submit time to serialise to the API contract.
//
// === HISTORY_BOUNDARY here is a UX hint ===
//
// Disables the submit button when from < boundary AND sets the
// `<input min=…>` attribute so the native date picker greys out
// pre-boundary dates. NOT the security boundary — see the file-level
// comment in `/api/operator/backfill/route.ts` (T-05.6-14-T1).
//
// === Hebrew + RTL ===
//
// S-8: all user-facing copy is Hebrew. Direction inherits from the
// `<html dir="rtl">` set by the dashboard root layout. The date inputs
// override with `dir="ltr"` so digits read naturally left-to-right
// (same convention as ManualOverridesCrud.tsx).
//
// === Free-tier exec budget note ===
//
// The footer copy makes the operator aware of the cost shape: ~6 step.runs
// per (date × store) pair × 21 days × 3 stores ≈ 380 execs (<1% of 50K
// monthly cap). Phase 22 smoke covers the typical 1-7-day range.

import { useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { STORE_ID_TO_NAME } from '@/lib/platformsByStore';
import { operatorFetch } from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Source of truth — mirrors the route's VALID_STORES allowlist.
const ALL_STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

// A8-F3 (2026-05-27): show human display names on the checkboxes
// (zolplus → "Zol Plus", usmile360 → "360usmile"). DISPLAY ONLY — the
// POSTed `storeIds` payload keeps the internal ids. STORE_ID_TO_NAME is the
// canonical id→name map (platformsByStore.ts).
const storeLabel = (id: string): string =>
  STORE_ID_TO_NAME[id as keyof typeof STORE_ID_TO_NAME] ?? id;

// D-A3 history boundary. Same value as eventBackfill.ts:111 +
// /api/operator/backfill/route.ts (HISTORY_BOUNDARY). UX hint only;
// the API route is the security boundary. See route file's comment.
const HISTORY_BOUNDARY = '2026-05-01';

type SuccessBody = {
  accepted: number;
  eventIds: string[];
  range: { from: string; to: string };
  storeIds: string[];
};

// Audit fix 2026-05-23 (d/HI-03): use Intl Asia/Jerusalem-formatted
// today string instead of `new Date().toISOString()`. The old call
// returned UTC midnight which, between 02:00 and 04:00 IL time
// (UTC 00:00-02:00 winter, 22:00-00:00 summer), was the WRONG calendar
// day for an IL operator. Now the picker defaults to the IL today even
// for early-morning sessions. Mirrors insights.ts:todayInIsrael()
// pattern + the MonthlyTables / CommandPalette helpers.
function todayInIsrael(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function BackfillPicker() {
  const todayIso = todayInIsrael();

  const [from, setFrom] = useState(HISTORY_BOUNDARY);
  const [to, setTo] = useState(todayIso);
  const [storeIds, setStoreIds] = useState<Set<string>>(
    () => new Set(ALL_STORES),
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await operatorFetch('/api/operator/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to,
          storeIds: Array.from(storeIds),
        }),
      });
      // 202 is the SUCCESS shape per the API contract. Anything else is
      // either a validation 400 (server-side guard caught what the
      // client guards missed) or a 500 (sanitised via userFacingError).
      if (res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as SuccessBody;
      // Hebrew confirmation. JobsTable (plan 13) is the operator's
      // observation surface for completion. We do NOT poll for status
      // here — per D-D4, async is the contract.
      setMessage(
        `Backfill נוסף לתור (${body.accepted} אירוע). עקוב אחר ההתקדמות בטבלת הריצות.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStore = (s: string) => {
    setStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  // Submit-button disable rule. Three conditions:
  //   1. submitting — prevent double-fire while the POST is in flight.
  //   2. storeIds empty — server would reject 400 anyway; surface the
  //      gate at the button to skip the round trip.
  //   3. from invalid — same fast-fail logic for history boundary and
  //      inverted range.
  const submitDisabled =
    submitting ||
    storeIds.size === 0 ||
    from < HISTORY_BOUNDARY ||
    from > to;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          <span className="text-ink-secondary mb-1">מתאריך</span>
          <Input
            type="date"
            value={from}
            min={HISTORY_BOUNDARY}
            onChange={(e) => setFrom(e.target.value)}
            dir="ltr"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-ink-secondary mb-1">עד תאריך</span>
          <Input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            dir="ltr"
          />
        </label>
        <div className="flex flex-col text-sm">
          <span className="text-ink-secondary mb-1">חנויות</span>
          <div className="flex gap-3">
            {ALL_STORES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-1 text-sm cursor-pointer"
              >
                <Input
                  type="checkbox"
                  checked={storeIds.has(s)}
                  onChange={() => toggleStore(s)}
                />
                <span>{storeLabel(s)}</span>
              </label>
            ))}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={submitDisabled}
          className="gap-1"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CalendarDays className="w-4 h-4" />
          )}
          {submitting ? 'מפעיל…' : 'הפעל Backfill'}
        </Button>
      </div>

      {message && (
        <p className="text-status-greenFg text-sm" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-status-redFg text-sm" role="alert">
          שגיאה: {error}
        </p>
      )}

      <p className="text-ink-secondary text-xs">
        Backfill מקצה ~6 step.runs לכל יום-חנות. טווח של 21 ימים × 3 חנויות ≈
        380 ביצועים (פחות מ-1% מתקרת Inngest). תאריך מינימלי:{' '}
        <span dir="ltr">{HISTORY_BOUNDARY}</span> (D-A3 history boundary).
      </p>
    </div>
  );
}

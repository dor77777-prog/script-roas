'use client';

// dashboard-web/src/components/operator/SyncNowButtons.tsx
//
// Phase 05.6 Plan 16 — operator "Sync now" 4-button grid.
//
// Renders 4 buttons: one global "Sync all stores" and one per store
// (uzoshop / zolplus / usmile360). Each click POSTs to
// /api/operator/sync-now with the matching `{scope: 'all'}` or
// `{scope: 'store', storeId}` payload. The API route (plan 14) returns
// 202 + { accepted, eventIds }; the worker (eventSyncNow.ts, plan 10)
// picks the event(s) up asynchronously, and the operator console's
// JobsTable section (plan 13) is the observation surface for completion.
//
// === Why 'use client' ===
//
// Three pieces of local state (pendingKey, message, error) + a click
// handler. No DOM effects. Server components cannot host useState; the
// entire component is interactive. SECURITY: this file intentionally
// has no `supabaseAdmin` and no Inngest event-key / signing-key env-var
// references — those are server-side concerns, and the verify gate
// greps for the absence of those identifiers here (threat T-05.6-16-I3
// mitigation: error message sanitisation lives in the route via
// userFacingError; the client only renders the already-sanitised
// string).
//
// === Why a single pendingKey (instead of one boolean per button) ===
//
// Threat T-05.6-16-T1: a hasty operator could click "Sync all" and then
// "uzoshop" in rapid succession, queuing duplicate work. By tracking a
// single `pendingKey: string | null`, we disable ALL buttons while any
// one of them is in flight. Inngest also dedupes identical events
// server-side (defense in depth), but the UI guard is the first line.
//
// === Why string IDs ('all' | storeId) instead of numeric/enum ===
//
// The pendingKey doubles as the spinner-selector key in JSX — we render
// the Loader2 spinner on whichever button matches the current key. A
// string namespace keeps the comparison trivial and the disabled-state
// math obvious.
//
// === Hebrew + RTL ===
//
// Match BackfillPicker.tsx's bilingual convention: technical nouns
// (storeId labels, "Sync now") stay English for grep / log alignment,
// surrounding copy is Hebrew. role="status" / role="alert" hooks for
// screen readers mirror BackfillPicker's accessibility pattern.
//
// === Free-tier exec budget note ===
//
// The footer copy makes the operator aware of the cost shape: clicking
// "Sync now (all)" enqueues 3 events × ~6 step.runs ≈ 18 execs per
// click; a per-store click is ~6 execs. Trivial against the 50K/month
// Inngest cap, but documenting the shape keeps the operator aligned
// with the same mental model BackfillPicker establishes.

import { useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { STORE_ID_TO_NAME } from '@/lib/platformsByStore';
import { operatorFetch } from '@/lib/operatorClient';

// Source of truth — mirrors the route's VALID_STORES allowlist
// (api/operator/sync-now/route.ts:58). Keeping the literal here rather
// than importing from the route keeps the client bundle free of any
// server-only modules that route.ts pulls in (inngest client, apiErrors).
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
type StoreId = (typeof STORES)[number];

// A8-F3 (2026-05-27): show human display names (zolplus → "Zol Plus",
// usmile360 → "360usmile") on the buttons. DISPLAY ONLY — the POSTed
// `storeId` payload stays the internal id. STORE_ID_TO_NAME is the
// canonical id→name map (platformsByStore.ts).
const storeLabel = (id: StoreId): string => STORE_ID_TO_NAME[id] ?? id;

type SyncPayload =
  | { scope: 'all' }
  | { scope: 'store'; storeId: StoreId };

// Mirror of the route's 202 success shape
// (api/operator/sync-now/route.ts:94-97). Kept as a local type rather
// than imported from the route module — same client-bundle hygiene
// reason as the STORES constant above.
type SyncResponse = { accepted: number; eventIds: string[] };

export function SyncNowButtons() {
  // `pendingKey` doubles as the spinner-selector and the global
  // disable gate. `null` = idle. 'all' | storeId = a POST is in flight
  // for that scope. See file-level T-05.6-16-T1 comment for why a
  // single key (not per-button booleans).
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = async (payload: SyncPayload, label: string) => {
    const key = payload.scope === 'all' ? 'all' : payload.storeId;
    setPendingKey(key);
    setMessage(null);
    setError(null);
    try {
      const res = await operatorFetch('/api/operator/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // 202 is the SUCCESS shape per the API contract (plan 14). Anything
      // else is either a validation 400 (server-side guard caught what
      // the client guards missed) or a 500 (sanitised via
      // userFacingError on the route side).
      if (res.status !== 202) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as SyncResponse;
      // Hebrew confirmation. JobsTable (plan 13) is the operator's
      // observation surface for completion. We do NOT poll for status
      // here — per D-D4, async is the contract.
      setMessage(
        `${label} — ${body.accepted} אירועים נשלחו. עקוב אחר ההתקדמות בטבלת הריצות.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => sync({ scope: 'all' }, 'Sync all stores')}
          disabled={pendingKey !== null}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm px-3 py-2 rounded"
        >
          {pendingKey === 'all' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Sync now (כל החנויות)
        </button>
        {STORES.map((storeId) => (
          <button
            key={storeId}
            type="button"
            onClick={() =>
              sync({ scope: 'store', storeId }, `Sync ${storeLabel(storeId)}`)
            }
            disabled={pendingKey !== null}
            className="flex items-center gap-1 bg-blue-700/70 hover:bg-blue-600/70 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm px-3 py-2 rounded"
          >
            {pendingKey === storeId ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {storeLabel(storeId)}
          </button>
        ))}
      </div>

      {message && (
        <p className="text-green-400 text-sm" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-red-400 text-sm" role="alert">
          שגיאה: {error}
        </p>
      )}

      <p className="text-text-secondary text-xs">
        * &quot;Sync now&quot; מפעיל את אותו handler של ה-cron היומי לתאריך
        הנוכחי (Asia/Jerusalem). כל לחיצה ≈ 6 ביצועי Inngest לחנות.
      </p>
    </div>
  );
}

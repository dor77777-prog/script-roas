/**
 * Cloud sync layer — keeps the dashboard's localStorage-backed state in sync
 * across devices and partners via the `dashboard-state` Google Sheet.
 *
 * Architecture
 * -------------
 * localStorage stays as a synchronous read cache (so every component that
 * already reads `readRecurring()` / `readAnnotations()` / etc. keeps working
 * without becoming async). On top of it, we add two flows:
 *
 *  1. **Hydrate**: on app mount, GET /api/dashboard-state once. For each
 *     known key, overwrite localStorage with the cloud value and dispatch the
 *     change event so already-mounted components re-read. If cloud is empty
 *     for a key BUT localStorage has data, we treat that as first-time
 *     migration and push the local data up to cloud.
 *
 *  2. **Write-through**: when any write function is called (writeRecurring,
 *     writeAnnotations, writeGoal, writeInsightStates), the existing code
 *     writes localStorage AND fires `pushCloudKey()` which does a debounced
 *     fire-and-forget POST. If the POST fails, we retry once after 5s; if
 *     that also fails we silently drop it — the user's next edit will
 *     overwrite anyway.
 *
 * Polling
 * -------
 * After initial hydrate, we re-fetch every 30s to pick up edits from other
 * devices. The poll merges keys conservatively: if a key has a pending write
 * locally (push in flight), we skip it for that round.
 *
 * Last-write-wins
 * ---------------
 * No real merging happens server-side. Two partners editing the same key at
 * the same time will see the later POST win. Acceptable for the kind of data
 * here (billing edits are rare, annotations are append-only, insight states
 * are user actions).
 */

/**
 * Every localStorage key that participates in cloud sync. Adding a new key
 * here is the ONE place to register it — `pushCloudKey`, `hydrateFromCloud`,
 * and `CHANGE_EVENTS` are all driven from this list, so we can't introduce
 * a key that pushes to cloud but never hydrates back (or vice-versa). This
 * closes the asymmetry the prior `pushCloudKey(string, unknown)` signature
 * permitted, where a developer could send a never-hydrated key into the
 * void.
 *
 * Exported so the parity guard (`__tests__/stateKeysParity.test.ts`) can assert
 * this list and the server allowlist (`dashboardStateKeys.ts:ALLOWED_STATE_KEYS`)
 * stay in lock-step — drift here previously broke COGS cross-device sync
 * (2026-06-02). Test-only import; the server module must NOT import this
 * browser-side module.
 */
export const STATE_KEYS = [
  'roas-dashboard:billing-recurring',
  'roas-dashboard:billing-onetime',
  'roas-dashboard:annotations',
  'roas-dashboard:monthly-revenue-goal',
  'roas-dashboard:insight-states',
  'roas-dashboard:campaign-optimized',
  'roas-dashboard:campaign-product-map',
  // Phase 05.7.9d — per-table column visibility preferences (hide/show).
  'roas-dashboard:campaigns-column-visibility',
  // Phase A.5 v2 (2026-05-29) — TikTok campaign↔store mapping. v1 was rolled
  // back due to a campaigns_daily PK duplication bug; v2 fixes that via
  // batch DELETE-then-UPSERT in persistCampaignsLive + cronDaily.
  'roas-dashboard:campaign-store-map',
  // Editable COGS % (2026-06-01) — per-month, retroactive, business/per-store.
  'roas-dashboard:cogs-settings',
  // Editable salaries % / amount (2026-06-02) — per-month, retroactive, business-level.
  'roas-dashboard:salary-settings',
  // Per-month monthly revenue goal (2026-06-02) — byMonth map, business-wide,
  // carry-forward default. Replaces the legacy single-number
  // 'monthly-revenue-goal' (kept above for back-compat hydrate + migration).
  'roas-dashboard:goal-settings',
  // Saved Views (2026-06-04) — named Filters snapshots (preset+range+store),
  // keyed by opaque id with createdAt/lastUsedAt. Device-synced.
  'roas-dashboard:saved-views',
] as const;
export type StateKey = (typeof STATE_KEYS)[number];

const CHANGE_EVENTS: Record<StateKey, string> = {
  'roas-dashboard:billing-recurring': 'roas-billing-changed',
  'roas-dashboard:billing-onetime': 'roas-billing-changed',
  'roas-dashboard:annotations': 'roas-annotations-changed',
  'roas-dashboard:monthly-revenue-goal': 'roas-goal-changed',
  'roas-dashboard:insight-states': 'roas-insight-states-changed',
  'roas-dashboard:campaign-optimized': 'roas-campaign-optimized-changed',
  'roas-dashboard:campaign-product-map': 'roas-campaign-product-map-changed',
  'roas-dashboard:campaigns-column-visibility': 'roas-campaigns-column-visibility-changed',
  'roas-dashboard:campaign-store-map': 'roas-campaign-store-map-changed',
  'roas-dashboard:cogs-settings': 'roas-cogs-settings-changed',
  'roas-dashboard:salary-settings': 'roas-salary-changed',
  // Shares the legacy goal event so both writers drive one re-render signal.
  'roas-dashboard:goal-settings': 'roas-goal-changed',
  'roas-dashboard:saved-views': 'roas-saved-views-changed',
};

/** ms epoch of the last push we sent for each key. Used to skip stomping
 *  our own value when a poll round comes back. */
// Phase 05.7.x (2026-05-23) — `lastPushAt` is now persisted to localStorage
// (with a `:lastPushAt` suffix per key) so the hydrate-grace check survives
// page reload. Previously this was in-memory only and a refresh between
// "operator clicked Save" and "POST finished" would reset it → the next
// hydrate would treat the cloud value as authoritative and silently
// overwrite the just-saved local value. The lsKey suffix avoids collisions
// with the actual stored values and is filtered out of the canonical keys
// list, so STATE_KEYS / pushCloudKey / hydrateFromCloud iteration is
// unaffected.
const LAST_PUSH_AT_SUFFIX = ':lastPushAt';

function getLastPushAt(lsKey: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(lsKey + LAST_PUSH_AT_SUFFIX);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setLastPushAt(lsKey: string, ts: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lsKey + LAST_PUSH_AT_SUFFIX, String(ts));
  } catch {
    /* quota / private mode — fall back to in-memory only */
  }
}

const lastPushAt: Record<string, number> = {};
/** Pending debounce timers per key (keyed by lsKey, e.g. `roas-dashboard:goal`). */
const pendingTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
/** In-flight retry timers per cloud key (keyed by the stripped form, e.g. just
 *  `goal`, because that's what `postWithRetry` is called with). A retry queued
 *  for a previous failed push captures the OLD value in its closure. If a
 *  newer push arrives for the same key BEFORE the retry fires, the retry can
 *  overwrite cloud with the stale value AFTER the newer push has already
 *  succeeded — silently reverting the user's edit (and, 30s later, their UI
 *  too via hydrate). We cancel any pending retry on every fresh push so the
 *  freshest value always wins. */
const pendingRetries: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
/** Marker we've completed initial hydrate at least once. */
let hydrated = false;

const HYDRATE_GRACE_MS = 8_000; // skip poll-overwrite within this window of a local push

// ---------------------------------------------------------------------------
// Sync status — exposed so the UI can show a small "synced / syncing / error"
// indicator. Critical for trust: if a write silently fails (e.g. the service
// account doesn't have Editor permission on the Sheet), the user otherwise
// has no way to know their data hasn't propagated.
// ---------------------------------------------------------------------------

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';
export type SyncState = {
  status: SyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Number of pending POSTs waiting to fire (debounce queue). */
  pendingKeys: number;
};

let syncState: SyncState = {
  status: 'idle',
  lastSyncAt: null,
  lastError: null,
  pendingKeys: 0,
};

function setSyncState(patch: Partial<SyncState>) {
  syncState = { ...syncState, ...patch };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('roas-cloud-sync-state'));
  }
}

/** Apply a patch computed from the *current* syncState. Used by code paths
 *  that decrement pendingKeys after an async resolution — without this, two
 *  pushes resolving in the same microtask both read pendingKeys before
 *  either has written, both compute (n-1), and the counter freezes at n-1
 *  instead of reaching 0. */
function updateSyncState(updater: (prev: SyncState) => Partial<SyncState>) {
  setSyncState(updater(syncState));
}

export function getSyncState(): SyncState {
  return syncState;
}

/**
 * Push a key's value up to the cloud. Debounced 400ms so rapid edits (e.g.
 * typing in an inline form) coalesce into one POST. Fire-and-forget — never
 * throws; the user shouldn't see UI errors for a sync failure.
 *
 * We mark `lastPushAt` immediately (not inside the timer callback) so a
 * `hydrateFromCloud()` racing the debounce window — triggered by a 30s poll
 * or a window-focus refresh — can detect we have an uncommitted local edit
 * and not stomp it with a stale cloud value. Without this, the focus listener
 * could overwrite the user's just-typed input before the debounce fires,
 * then the debounced push would re-upload the now-overwritten stale value
 * to cloud (losing the edit on server too).
 */
export function pushCloudKey(
  localStorageKey: StateKey,
  value: unknown,
  options?: { immediate?: boolean },
): void {
  if (typeof window === 'undefined') return;
  const cloudKey = stripPrefix(localStorageKey);

  if (!pendingTimers[localStorageKey]) {
    updateSyncState(prev => ({
      status: 'syncing',
      pendingKeys: prev.pendingKeys + 1,
    }));
  } else {
    clearTimeout(pendingTimers[localStorageKey]);
  }

  // Cancel any in-flight retry for this key — the value we're about to send
  // supersedes whatever value the retry captured in its closure. Without
  // this, a retry queued for an earlier failed push would fire AFTER this
  // newer push succeeds, overwriting cloud with the stale value (and 30s
  // later the user's UI too, via hydrate).
  //
  // pendingKeys accounting: the failed-but-retrying push's contribution to
  // pendingKeys is still alive (postWithRetry only decrements on success or
  // final failure, not on a retry-scheduling). Cancelling the retry means
  // that push is abandoned, so we decrement once. The new debounce above
  // manages its own +1 via the !pendingTimers branch.
  const existingRetry = pendingRetries[cloudKey];
  if (existingRetry !== undefined) {
    clearTimeout(existingRetry);
    pendingRetries[cloudKey] = undefined;
    updateSyncState(prev => ({
      pendingKeys: Math.max(0, prev.pendingKeys - 1),
    }));
  }

  // Mark immediately so concurrent hydrates inside the debounce window
  // recognize this key as locally dirty and skip the overwrite. Also
  // persist to localStorage so the grace check survives page reload —
  // an operator who clicks Save and refreshes within seconds would
  // otherwise lose the just-saved value to the next hydrate.
  const nowMs = Date.now();
  lastPushAt[localStorageKey] = nowMs;
  setLastPushAt(localStorageKey, nowMs);

  // Phase 05.7.x (2026-05-23) — `immediate: true` bypasses the 400ms
  // debounce and fires the POST synchronously. Used by explicit
  // "Save" actions (e.g. product mapping) where the user has clicked
  // a button and may refresh / close the tab immediately after. The
  // debounce is only valuable for fast-typing scenarios (goal input,
  // annotations) where bundling keystrokes saves API calls. For a
  // discrete save, the cost of an extra debounce is far outweighed
  // by the bug it causes: user-saves-then-refreshes → debounce never
  // fires → hydrateFromCloud overwrites the just-saved value with
  // the stale cloud value → user's mapping is silently lost.
  if (options?.immediate) {
    pendingTimers[localStorageKey] = undefined;
    void postWithRetry(cloudKey, value);
    return;
  }

  pendingTimers[localStorageKey] = setTimeout(() => {
    pendingTimers[localStorageKey] = undefined;
    // Refresh the marker on actual send so the post-send grace window
    // (HYDRATE_GRACE_MS) measures from the send, not from the edit.
    const sendTs = Date.now();
    lastPushAt[localStorageKey] = sendTs;
    setLastPushAt(localStorageKey, sendTs);
    void postWithRetry(cloudKey, value);
  }, 400);
}

/**
 * Phase 12.5.x audit fix (2026-05-24, MEDIUM #5) — retry schedule.
 *
 * Pre-fix: 2 attempts total (initial + one retry after 5s). On a brief
 * network blip > 5s the second attempt would also fail and the push was
 * silently dropped, leaving partner devices out of sync indefinitely.
 *
 * Post-fix: 4 attempts with exponential backoff so a transient outage
 * up to ~3 min has multiple chances to succeed before we give up. The
 * cap is intentional: forever-retry could pile up pending callbacks
 * across page sessions; 4 attempts is enough for real-world ISP/WiFi
 * blips while still surfacing a persistent error to the user's
 * SyncIndicator within a reasonable window.
 *
 * Delays (ms): 5_000, 15_000, 45_000.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

async function postWithRetry(key: string, value: unknown, attempt = 1): Promise<void> {
  // This fire is no longer "pending" — clear the slot so a concurrent
  // pushCloudKey doesn't redundantly cancel-and-decrement.
  pendingRetries[key] = undefined;
  try {
    const res = await fetch('/api/dashboard-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) {
      // Surface the server's actual error so the user can see "service account
      // doesn't have Editor permission" instead of a silent failure.
      const body = await res.json().catch(() => ({}));
      const msg = (body && body.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    // Phase 05.7.x (2026-05-23) — bump lastPushAt on SUCCESS so the
    // grace window resets at the moment the cloud actually has the new
    // value. Without this, a slow POST (e.g. ~3s due to network spike)
    // would leave only ~5s of grace before the next hydrate could
    // overwrite, even though the cloud value IS the new one by then —
    // tight but correct. With this, the grace measures from confirmed
    // persistence instead.
    const successTs = Date.now();
    const lsKey = STATE_KEYS.find(k => stripPrefix(k) === key);
    if (lsKey) {
      lastPushAt[lsKey] = successTs;
      setLastPushAt(lsKey, successTs);
    }
    // Functional update so the decrement reads the freshest pendingKeys
    // count (defensive — JS's single-threaded scheduler already prevents
    // interleaving inside one resolution, but this also covers any future
    // refactor that splits the read/write across await boundaries).
    updateSyncState(prev => {
      const nextPending = Math.max(0, prev.pendingKeys - 1);
      return {
        status: nextPending === 0 ? 'ok' : 'syncing',
        lastSyncAt: Date.now(),
        lastError: null,
        pendingKeys: nextPending,
      };
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `cloudSync push failed (${key}) after ${MAX_ATTEMPTS} attempts:`,
        message,
      );
      updateSyncState(prev => ({
        status: 'error',
        lastError: `כתיבה ל-${key} נכשלה: ${message}`,
        pendingKeys: Math.max(0, prev.pendingKeys - 1),
      }));
      return;
    }
    // Schedule next retry with exponential backoff. Track the timer in
    // pendingRetries so a newer pushCloudKey(key, ...) can cancel it
    // BEFORE it fires (WR2-01). Without this tracking, the retry's
    // closure captures the old `value` and can overwrite cloud with the
    // stale value after the newer push has already succeeded.
    const delay = RETRY_DELAYS_MS[attempt - 1];
    pendingRetries[key] = setTimeout(
      () => void postWithRetry(key, value, attempt + 1),
      delay,
    );
  }
}

/**
 * Pull the cloud state and reconcile with localStorage. Called once on mount
 * by `<CloudSync />` and again on each poll tick.
 *
 * Returns true once at least one successful hydrate has completed — used to
 * gate the initial seed in BillingSettings so we don't double-seed on the
 * first visit while the cloud fetch is still in flight.
 */
export async function hydrateFromCloud(): Promise<boolean> {
  if (typeof window === 'undefined') return hydrated;
  let payload: { kv?: Record<string, unknown>; error?: string } | null = null;
  try {
    const r = await fetch('/api/dashboard-state', { cache: 'no-store' });
    payload = (await r.json()) as { kv?: Record<string, unknown>; error?: string };
    if (!r.ok || payload.error) {
      setSyncState({
        status: 'error',
        lastError: `קריאה מהענן נכשלה: ${payload.error || `HTTP ${r.status}`}`,
      });
      return hydrated;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSyncState({ status: 'error', lastError: `רשת: ${message}` });
    return hydrated;
  }

  const cloud = payload?.kv ?? {};

  for (const lsKey of STATE_KEYS) {
    const cloudKey = stripPrefix(lsKey);
    const cloudHas = Object.prototype.hasOwnProperty.call(cloud, cloudKey);
    const cloudVal = cloud[cloudKey];

    // Skip stomping local state if (a) a debounce timer is still pending for
    // this key — the local value is dirty and not yet on the server, so the
    // cloud value is guaranteed stale; or (b) we recently pushed and cloud
    // may still be serving the pre-push value due to caching.
    if (pendingTimers[lsKey]) {
      continue;
    }
    // Read lastPushAt from BOTH the in-memory map AND localStorage. The
    // localStorage variant is set in pushCloudKey() and survives page
    // reload, so a refresh between "operator clicks Save" and "POST
    // succeeds" no longer drops the local value. Without this, the prior
    // in-memory-only check reset to 0 on every reload and the cloud value
    // (still stale from before the user's edit) would overwrite the just-
    // saved local mapping.
    const lastPushTs = Math.max(
      lastPushAt[lsKey] ?? 0,
      getLastPushAt(lsKey),
    );
    if (lastPushTs && Date.now() - lastPushTs < HYDRATE_GRACE_MS) {
      continue;
    }

    if (!cloudHas) {
      // First-time migration: cloud has no row for this key at all. Push
      // local state up if any so partners on other devices pick it up.
      const local = readLocal(lsKey);
      if (local !== null) {
        lastPushAt[lsKey] = Date.now();
        // Bump pendingKeys so the SyncIndicator pill reflects in-flight
        // migration pushes alongside any debounced user pushes. Without this
        // the counter drifts and "ok" can fire prematurely while migration
        // POSTs are still racing.
        updateSyncState(prev => ({
          status: 'syncing',
          pendingKeys: prev.pendingKeys + 1,
        }));
        void postWithRetry(cloudKey, local);
      }
      continue;
    }

    if (cloudVal === null || cloudVal === undefined) {
      // P1-18 (2026-06-10 audit): if the key is ALREADY absent locally there
      // is nothing to mirror — skip the remove + clear-conflict event +
      // dispatchChange. Pre-fix this branch re-fired the change event every
      // 30s poll for every null cloud row, even with nothing to clear.
      if (readLocal(lsKey) === null) continue;
      // Cloud row exists but value is null or undefined.
      //  - null: the user (possibly on another device) cleared the key.
      //  - undefined: a row with key set but column B blank, possible if
      //    ops manually deleted the value cell. fetchDashboardState stores
      //    kv[key] = undefined in that case, which then slipped through to
      //    writeLocal as undefined → localStorage.setItem coerces to the
      //    literal string "undefined" → next read parses to "undefined"
      //    → silent data loss (Array.isArray("undefined") === false → []).
      //
      // Mirror deletion locally for both cases so we don't re-push a stale
      // local value, and we don't write the literal string "undefined" to
      // localStorage. CRITICAL: without this branch, a deleted goal would
      // resurrect from a partner's localStorage every poll cycle.
      removeLocal(lsKey);
      // Audit fix 2026-05-23 (d/CR-07-soft): a partner-induced clear can
      // silently destroy the operator's draft on this device. Notify the
      // UI via a dedicated event so SyncIndicator (or any listener) can
      // surface a toast/banner. The auto-merge contract itself is
      // unchanged — we still mirror the deletion locally — but the
      // operator at least sees that an outside change just landed.
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('roas-cloud-clear-conflict', {
              detail: { key: lsKey },
            }),
          );
        } catch (e) {
          console.warn(
            `cloudSync: clear-conflict dispatch failed for ${lsKey}:`,
            e instanceof Error ? e.message : e,
          );
        }
        console.warn(
          `cloudSync: partner-induced clear arrived for ${lsKey} — local value removed`,
        );
      }
      // Audit fix 2026-05-23 (d/MD-01): wrap dispatchChange so one broken
      // listener (e.g. throws synchronously on the change event) doesn't
      // abort the rest of the hydrate loop and leave the remaining keys
      // un-hydrated. The CustomEvent dispatch itself is synchronous —
      // listener exceptions propagate to the caller.
      try {
        dispatchChange(lsKey);
      } catch (e) {
        console.warn(
          `cloudSync: dispatchChange failed for ${lsKey}:`,
          e instanceof Error ? e.message : e,
        );
      }
      continue;
    }

    // Cloud wins on the regular path.
    //
    // P1-18 (2026-06-10 audit): EQUALITY GUARD. Pre-fix, writeLocal +
    // dispatchChange fired for EVERY cloud key on EVERY 30s poll regardless
    // of whether the value changed — 'roas-billing-changed' alone triggered
    // an /api/data SWR revalidation + a full re-aggregate cascade twice per
    // poll, silently undoing the 120s auto-refresh cost-cut. Skip when the
    // incoming cloud value deep-equals the current local value.
    if (jsonEq(readLocal(lsKey), cloudVal)) continue;
    writeLocal(lsKey, cloudVal);
    // Audit fix 2026-05-23 (d/MD-01): same protection as above.
    try {
      dispatchChange(lsKey);
    } catch (e) {
      console.warn(
        `cloudSync: dispatchChange failed for ${lsKey}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Pulled cleanly. If we had a prior error and no writes are pending, clear it.
  if (syncState.status !== 'syncing' && syncState.pendingKeys === 0) {
    setSyncState({ status: 'ok', lastSyncAt: Date.now(), lastError: null });
  }

  if (!hydrated) {
    hydrated = true;
    // Let gated logic (e.g. BillingSettings' default seed) know cloud has spoken.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('roas-cloud-hydrated'));
    }
  }
  return true;
}

/**
 * P1-18 — structural equality via JSON round-trip. Both sides are
 * already-parsed values (readLocal parses; cloud kv arrives parsed), so a
 * stringify-compare is the cheapest stable deep-equal for these small
 * settings payloads. Returns false on stringify failure (treat as changed).
 */
function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function dispatchChange(lsKey: StateKey) {
  const evt = CHANGE_EVENTS[lsKey];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(evt));
  }
}

function stripPrefix(lsKey: string): string {
  return lsKey.replace(/^roas-dashboard:/, '');
}

function readLocal(lsKey: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(lsKey);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Goal is stored as a bare number string; return as-is.
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
  } catch {
    return null;
  }
}

function writeLocal(lsKey: string, value: unknown) {
  if (typeof window === 'undefined') return;
  // Defense in depth (WR2-04): JSON.stringify(undefined) returns undefined
  // (not "undefined") and setItem then coerces to the literal string
  // "undefined", which on the next read appears as valid persisted data
  // and causes silent data loss (Array.isArray("undefined") is false →
  // safeReadArray returns []). The hydrate branch above already routes
  // undefined to removeLocal, but routes that bypass hydrate (future
  // refactors, direct callers) should not be able to corrupt storage.
  if (value === undefined) {
    removeLocal(lsKey);
    return;
  }
  try {
    if (typeof value === 'number' || typeof value === 'string') {
      window.localStorage.setItem(lsKey, String(value));
    } else {
      window.localStorage.setItem(lsKey, JSON.stringify(value));
    }
  } catch {
    /* quota / private mode */
  }
}

/** Used by hydrate when cloud signals "this key was explicitly cleared"
 *  (cloud row exists with a null value). Removes the localStorage entry so
 *  the next read sees the key as absent rather than as a stale string. */
function removeLocal(lsKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(lsKey);
  } catch {
    /* quota / private mode */
  }
}

/** Has initial cloud hydrate completed at least once this session? Used by
 *  seed logic to avoid seeding before we know what the cloud has. */
export function isHydrated(): boolean {
  return hydrated;
}

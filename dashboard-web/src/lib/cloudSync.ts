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
 */
const STATE_KEYS = [
  'roas-dashboard:billing-recurring',
  'roas-dashboard:billing-onetime',
  'roas-dashboard:annotations',
  'roas-dashboard:monthly-revenue-goal',
  'roas-dashboard:insight-states',
  'roas-dashboard:campaign-optimized',
  'roas-dashboard:campaign-product-map',
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
};

/** ms epoch of the last push we sent for each key. Used to skip stomping
 *  our own value when a poll round comes back. */
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
export function pushCloudKey(localStorageKey: StateKey, value: unknown): void {
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
  // recognize this key as locally dirty and skip the overwrite.
  lastPushAt[localStorageKey] = Date.now();

  pendingTimers[localStorageKey] = setTimeout(() => {
    pendingTimers[localStorageKey] = undefined;
    // Refresh the marker on actual send so the post-send grace window
    // (HYDRATE_GRACE_MS) measures from the send, not from the edit.
    lastPushAt[localStorageKey] = Date.now();
    void postWithRetry(cloudKey, value);
  }, 400);
}

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
    if (attempt >= 2) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`cloudSync push failed (${key}):`, message);
      updateSyncState(prev => ({
        status: 'error',
        lastError: `כתיבה ל-${key} נכשלה: ${message}`,
        pendingKeys: Math.max(0, prev.pendingKeys - 1),
      }));
      return;
    }
    // Schedule a single retry. Track the timer in pendingRetries so a
    // newer pushCloudKey(key, ...) can cancel it BEFORE it fires (WR2-01).
    // Without this tracking, the retry's closure captures the old `value`
    // and can overwrite cloud with the stale value after the newer push
    // has already succeeded.
    pendingRetries[key] = setTimeout(
      () => void postWithRetry(key, value, attempt + 1),
      5000,
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
    if (lastPushAt[lsKey] && Date.now() - lastPushAt[lsKey] < HYDRATE_GRACE_MS) {
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
      dispatchChange(lsKey);
      continue;
    }

    // Cloud wins on the regular path.
    writeLocal(lsKey, cloudVal);
    dispatchChange(lsKey);
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

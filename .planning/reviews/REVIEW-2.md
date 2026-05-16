---
phase: reviews
reviewed: 2026-05-16T21:30:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - SheetBuilder.gs
  - Shopify.gs
  - dashboard-web/src/app/api/dashboard-state/route.ts
  - dashboard-web/src/app/api/store-meta/route.ts
  - dashboard-web/src/components/BillingSettings.tsx
  - dashboard-web/src/components/Dashboard.tsx
  - dashboard-web/src/components/GoalTracker.tsx
  - dashboard-web/src/components/SyncIndicator.tsx
  - dashboard-web/src/lib/analytics.ts
  - dashboard-web/src/lib/annotations.ts
  - dashboard-web/src/lib/billing.ts
  - dashboard-web/src/lib/cloudSync.ts
  - dashboard-web/src/lib/constants.ts
  - dashboard-web/src/lib/insights.ts
  - dashboard-web/src/lib/sheets.ts
counts:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 2: Follow-up Code Review Report

**Reviewed:** 2026-05-16T21:30:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

The four BLOCKER fixes from the prior pass and most warnings/infos are correctly applied. CR-02 (cloud-cleared vs cloud-empty), CR-03 (immediate `lastPushAt` mark + pendingTimers belt-and-suspenders), and CR-04 (Shopify GraphQL error surfacing through to BillingSettings UI) all check out end-to-end. The new `lib/constants.ts` is clean and follows naming conventions; WR-11 is fully centralized.

However, **CR-01's fix introduces a new critical regression**: the move from "calculate `targetRow` + update" to "append on missing key" eliminated the cross-key race (good) but produces **duplicate rows that silently shadow user writes** when two POSTs for the SAME new key race. Under the previous code, two concurrent same-key POSTs collided last-write-wins on the computed row (acceptable). Under the new code, both calls take the append branch and create distinct rows; subsequent `update`s find the FIRST duplicate via `findIndex` while `fetchDashboardState`'s map-overwrite returns the LAST duplicate, so writes become invisible to reads. The CR-01 fix description explicitly claimed "two for the same key produce a duplicate row that subsequent reads dedupe rather than destroying either write" — that claim is wrong; reads do not dedupe.

A secondary correctness bug exists in `postWithRetry`: a retry queued for a previous failed push captures the OLD value in its closure and is never cancelled when a newer `pushCloudKey(sameKey, newValue)` arrives. The 5-second retry can fire AFTER the newer push has succeeded, silently rolling cloud state back to the older value.

The remainder of the new code is sound. The only minor issues are dead/duplicate magic numbers (a `0.25` COGS constant in `forecastMonthEnd` that should reference `COGS_RATE_OF_REVENUE`, like FROZEN_USD_TO_CAD now does), an absent input validation on the POST `key` parameter (allows storing `"__proto__"` and similar reserved names), and the `commitEdit` path in GoalTracker silently swallows invalid input.

## BLOCKER Issues

### CR2-01: `upsertDashboardStateKey` produces silently-shadowing duplicate rows on same-key concurrent appends

**File:** `dashboard-web/src/lib/sheets.ts:271-311`
**Severity:** BLOCKER (regression of CR-01)
**Issue:**
The prior review's CR-01 race was: two concurrent POSTs for DIFFERENT missing keys compute the same `targetRow = keys.length + 2` and the second silently overwrites the first. The fix routes new-key writes through `spreadsheets.values.append`, which is server-side atomic — different keys land on different rows. That works.

But the fix changed the failure semantics for the SAME new key. Trace:

1. App mounts. `hydrateFromCloud` discovers `monthly-revenue-goal` missing in cloud, local has a value → fires `void postWithRetry('monthly-revenue-goal', N)` (no debounce, direct call from cloudSync.ts:257).
2. Concurrently, the user edits the goal → `pushCloudKey` debounces 400ms → eventually fires `postWithRetry('monthly-revenue-goal', M)`.
3. Both `upsertDashboardStateKey` invocations read `colA` (sheets.ts:279-285) at roughly the same moment. Neither sees the other's pending write yet. `existingIdx` is -1 for both.
4. Both fall into the append branch (sheets.ts:304-310) and **two rows now exist with key=`monthly-revenue-goal`** — one with value N, one with value M.

Now the read/write asymmetry kicks in:
- `fetchDashboardState` iterates rows (sheets.ts:226-241): `kv[key] = parsed` overwrites for each duplicate. **The LAST row in the sheet wins on reads.**
- Future writes via `upsertDashboardStateKey` call `keys.findIndex(k => k === key)` (sheets.ts:285) which returns the **FIRST** match → updates row 1.
- Reads continue to return row 2's value. **The user's updates are silently invisible** until someone manually dedupes the sheet.

The CR-01 fix's docstring at sheets.ts:266-269 states "two for the same key produce a duplicate row that subsequent reads dedupe rather than destroying either write" — this is incorrect. Reads do NOT dedupe; they last-write-wins on row order. The `findIndex`-based update path subsequently writes to a row that reads never see.

This is reachable today, not theoretical:
- First-deploy migration with a user typing concurrently (very common).
- `SyncIndicator.onClick` triggering `hydrateFromCloud` while a debounced push is in flight (WR-03 was supposed to gate this but only blocks when `status === 'syncing'`; if status is `'ok'` with `pendingKeys === 0` after a recently-failed-but-not-yet-error retry, the click fires hydrate and the migration loop fires another POST for the same key).
- WR-04 fix's functional updates protect pendingKeys atomicity but do nothing about same-key append races.

Worse, under the OLD code, two same-key concurrent POSTs collided on the SAME `targetRow` and last-write-wins — acceptable. The new code makes the failure mode silent and persistent.

**Fix:**
The cleanest fix is to make the upsert genuinely atomic. Options:

A. Re-read after the append; if duplicates exist, delete extras (still a TOCTOU window, but bounded).

B. Move new-key writes into a `batchUpdate` with an `appendCells` request that includes an "if-not-exists" check — Sheets doesn't natively support this, so requires a script-lock fallback.

C. Compute existing/new in ONE call: use `appendCells` for the row but enforce uniqueness in `fetchDashboardState` by keeping the row with the latest `updatedAt`:
```ts
for (const row of values) {
  // ...
  const prev = updatedAtByKey[key];
  const updatedAt = row[2] ? String(row[2]) : '';
  if (prev && updatedAt < prev) continue;  // keep newer row
  kv[key] = parsed;
  updatedAtByKey[key] = updatedAt;
}
```
This makes reads dedupe-aware and at least makes them consistent with each other (newest wins). It does NOT solve the silently-orphaned row from a future `update`, so you should ALSO swap `findIndex` for "find the most recent row with this key":
```ts
let bestIdx = -1;
let bestAt = '';
for (let i = 0; i < keys.length; i++) {
  if (keys[i] !== key) continue;
  const at = String(updatedAtCol[i] ?? '');
  if (at >= bestAt) { bestAt = at; bestIdx = i; }
}
```

D. Best: serialize all writes through a single mutex (Apps Script's LockService equivalent) at the API route layer. For Next.js this is harder because of multi-instance deployment — but a global module-level promise chain works for single-instance.

Until fixed, **also document a manual recovery procedure**: a `dedupeStateTab()` Apps Script function that scans for duplicate keys and keeps only the most recent.

---

## Warning Issues

### WR2-01: `postWithRetry`'s 5-second retry can overwrite cloud with stale value when newer push succeeds first

**File:** `dashboard-web/src/lib/cloudSync.ts:183-195`
**Severity:** WARNING
**Issue:**
On push failure, line 194 schedules a retry: `setTimeout(() => void postWithRetry(key, value, attempt + 1), 5000)`. The retry's `value` is captured by closure from the original call. Between the failure and the retry, the user may have typed again and triggered a new `pushCloudKey` for the same key with a NEWER value. Trace:

1. t=0: User types A → debounce → t=400: `postWithRetry('goal', "100")` → fails → schedules retry at t=5400 with value="100".
2. t=2000: User types B → debounce → t=2400: `postWithRetry('goal', "200")` → succeeds → cloud has "200". pendingKeys=0, status=ok.
3. t=5400: Old retry fires → `postWithRetry('goal', "100")` → succeeds → cloud silently reverts to "100".

After step 3, the user's UI shows 200 (from their typing), but cloud has 100. Next 30s poll: cloudVal=100 → hydrate's writeLocal updates localStorage to 100 → dispatchChange → GoalTracker re-reads → setGoal(100). **The user's edit silently reverts both server-side and on their own screen 30 seconds later.**

The newer `pushCloudKey` doesn't know about the in-flight retry. There's no per-key retry cancellation.

**Fix:**
Track in-flight retries per key and cancel them on a new push:
```ts
const pendingRetries: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

export function pushCloudKey(localStorageKey: StateKey, value: unknown): void {
  // ... existing logic ...
  // Cancel any in-flight retry for this key — the value we're about to send
  // supersedes whatever the retry was holding.
  if (pendingRetries[localStorageKey]) {
    clearTimeout(pendingRetries[localStorageKey]);
    pendingRetries[localStorageKey] = undefined;
  }
  // ...
}

async function postWithRetry(key: string, value: unknown, attempt = 1): Promise<void> {
  // ... on error path ...
  pendingRetries[`roas-dashboard:${key}`] = setTimeout(
    () => void postWithRetry(key, value, attempt + 1),
    5000,
  );
}
```

Alternatively, track a per-key generation counter and bail in the retry if the generation has advanced.

---

### WR2-02: BillingSettings safety-net seed can still overwrite a partner's data, not just collide

**File:** `dashboard-web/src/components/BillingSettings.tsx:137-164`
**Severity:** WARNING
**Issue:**
WR-02's fix added a safety-net `/api/dashboard-state` fetch right before seeding. But the fetch+seed sequence is not atomic. Trace:

1. Device B mounts BillingSettings. Cloud is empty for billing keys, local is empty.
2. `maybeSeed` runs → fetches `/api/dashboard-state` → response has empty cloud (`kv['billing-recurring']` absent).
3. Concurrently, Device A's partner pushes their billing data → POST lands → cloud now has partner's data.
4. Back on Device B: `seedBillingIfEmpty(storeNames)` → writeRecurring(seedItems) → `pushCloudKey('billing-recurring', seedItems)` → 400ms debounce → POST.
5. Device B's POST goes to `upsertDashboardStateKey`. Reads colA. Finds key (Device A's row). Takes the UPDATE branch. Overwrites Device A's data with the seed.

Result: partner's data permanently lost from cloud, AND Device A's next hydrate sees the seed and stomps Device A's local copy too.

The window is the time between Device B's safety-net fetch resolving and Device B's pushCloudKey landing. Easily 500ms-2s on a typical mount. The comment at line 154-159 acknowledges this race exists ("the cost is a momentary duplicate, which is recoverable") but **misdescribes the outcome**: it's not a duplicate, it's overwriting a partner. The "cloud-wins path" only re-installs partner's data if cloud retains it — but cloud has been overwritten with the seed by then.

**Fix:**
Either (a) remove client-side seeding entirely — make it a server-driven first-run procedure, or (b) make the seed push conditional on cloud STILL being empty at write time. The latter requires a compare-and-set endpoint:
```ts
// POST /api/dashboard-state/seed-if-empty
// Body: { key, value }
// Behavior: only writes if column A doesn't contain `key`. Returns 409 if it does.
```

A weaker fix is to skip seeding entirely if `isHydrated()` is true at mount: that means the user has already opened the dashboard before. Cloud will be the source of truth from this point.

---

### WR2-03: POST `/api/dashboard-state` accepts arbitrary `key` — enables prototype pollution on hydrate

**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:55-68` and `dashboard-web/src/lib/sheets.ts:226-241`
**Severity:** WARNING (security / robustness)
**Issue:**
The POST handler validates only that `body.key` is a non-empty string (line 58). It does not restrict to known `STATE_KEYS`. A client (legitimate or adversarial) can write rows like `key="__proto__"` or `key="constructor"` to the sheet. On the next `fetchDashboardState`:

```ts
const kv: DashboardStateMap = {};
// ...
kv[key] = parsed;  // sheets.ts:239
```

If `key === '__proto__'` and `parsed` is an object, this sets `Object.prototype` properties — affecting EVERY subsequent object creation in that Node.js process (until restart). E.g., `kv['__proto__'] = { isAdmin: true }` would make `{}.isAdmin === true` everywhere.

The same applies to `key === 'constructor'` (less impactful but unusual).

While the dashboard is presumably behind auth, the validation gap is unnecessary and the type-system `StateKey` already enumerates the legitimate keys. Defense-in-depth: validate at the API boundary.

**Fix:**
Mirror the typed list at the API:
```ts
// In sheets.ts, export the list:
export const ALLOWED_STATE_KEYS = [
  'billing-recurring',
  'billing-onetime',
  'annotations',
  'monthly-revenue-goal',
  'insight-states',
] as const;

// In route.ts POST:
if (!ALLOWED_STATE_KEYS.includes(body.key as never)) {
  return NextResponse.json({ error: 'unknown key' }, { status: 400 });
}
```

Also harden `fetchDashboardState` against prototype pollution by using `Object.create(null)`:
```ts
const kv: DashboardStateMap = Object.create(null) as DashboardStateMap;
```

`hasOwnProperty.call(cloud, cloudKey)` already handles the prototype-less case correctly.

---

### WR2-04: `writeLocal` produces literal string "undefined" when `cloudVal === undefined` slips past the null branch

**File:** `dashboard-web/src/lib/cloudSync.ts:262-275` and `:321-332`
**Severity:** WARNING
**Issue:**
The hydrate loop's new structure (lines 243-275) has:
- `cloudHas && cloudVal === null` → `removeLocal` ✓
- `cloudHas && cloudVal === undefined` → falls through to `writeLocal(lsKey, undefined)`

This last case shouldn't normally happen — `fetchDashboardState` (sheets.ts:229-238) only sets `kv[key] = parsed` when key is present, and `parsed` defaults to `rawValue`. If column B is empty for a row, `rawValue` is `undefined` (Google Sheets API returns sparse arrays for empty cells). Then `parsed = undefined`. Then `kv[key] = undefined` — but the key IS set in the object, so `hasOwnProperty` returns true.

In `writeLocal`:
```ts
if (typeof value === 'number' || typeof value === 'string') {
  window.localStorage.setItem(lsKey, String(value));
} else {
  window.localStorage.setItem(lsKey, JSON.stringify(value));
}
```

`JSON.stringify(undefined)` returns the literal JavaScript value `undefined` (not the string `"undefined"`). `localStorage.setItem(lsKey, undefined)` coerces the second argument to the string `"undefined"`. On next read:
- `JSON.parse("undefined")` throws SyntaxError → caught.
- The catch returns the raw string `"undefined"` (`readLocal` falls back to raw via Number coercion → NaN → returns raw).
- `safeReadArray` in billing.ts: `Array.isArray("undefined")` is false → returns `[]`. Silent data loss for billing.
- `readGoal` in insights.ts: `Number("undefined")` is NaN → returns null. OK for goal.
- `readAnnotations` in annotations.ts: `JSON.parse("undefined")` throws → catch → returns []. Silent data loss.

How does `cloudVal === undefined` happen? Two ways:
1. Manual sheet edit by ops deleting column B for a row.
2. `JSON.stringify(undefined)` server-side. The POST handler writes `body.value ?? null` (line 61) so it normalizes undefined to null. But `upsertDashboardStateKey` then does `JSON.stringify(null)` = `"null"` (not undefined). So server-originated undefined is unreachable.

So the issue requires manual sheet edits — low probability. But the failure mode is **silent**.

**Fix:**
Treat `undefined` like `null` in the hydrate branch:
```ts
if (cloudVal === null || cloudVal === undefined) {
  removeLocal(lsKey);
  dispatchChange(lsKey);
  continue;
}
```

Or harden `writeLocal` to refuse to persist undefined:
```ts
function writeLocal(lsKey: string, value: unknown) {
  if (typeof window === 'undefined') return;
  if (value === undefined) {
    removeLocal(lsKey);
    return;
  }
  // ... existing logic
}
```

---

## Info Issues

### IN2-01: `forecastMonthEnd` hardcodes 25% COGS rate instead of using `COGS_RATE_OF_REVENUE`

**File:** `dashboard-web/src/lib/insights.ts:498`
**Severity:** INFO
**Issue:**
WR-11 centralized USD→CAD into `FROZEN_USD_TO_CAD`. The COGS rate has the same shape — a constant duplicated in two places:
- `dashboard-web/src/lib/analytics.ts:11`: `export const COGS_RATE_OF_REVENUE = 0.25`
- `dashboard-web/src/lib/insights.ts:498`: `const projectedNet = projectedRev - projectedSpend - projectedRev * 0.25; // 25% COGS`

If the rate changes (and the analytics.ts docstring at line 9 explicitly mentions the Apps Script Config.gs side also needs to track it), this hardcoded `0.25` in insights.ts is a third drift point. The inline comment `// 25% COGS` makes the magic number even more conspicuous.

**Fix:**
```ts
import { COGS_RATE_OF_REVENUE } from './analytics';
// ...
const projectedNet = projectedRev - projectedSpend - projectedRev * COGS_RATE_OF_REVENUE;
```

---

### IN2-02: `commitEdit` in GoalTracker silently swallows invalid non-empty input

**File:** `dashboard-web/src/components/GoalTracker.tsx:62-72`
**Severity:** INFO
**Issue:**
```ts
function commitEdit() {
  const n = Number(draft.replace(/,/g, ''));
  if (Number.isFinite(n) && n > 0) {
    setGoal(n);
    writeGoal(n);
  } else if (draft.trim() === '') {
    setGoal(null);
    writeGoal(null);
  }
  setEditing(false);
}
```

If the user types something that parses to NaN (e.g., they paste `abc`) OR a non-positive number (e.g., they type `-5` or `0`), the function falls through both branches and just exits edit mode. The draft is discarded silently. There's no user feedback that the input was invalid.

The input field at line 128 already filters to digits and commas (`e.target.value.replace(/[^\d,]/g, '')`) — so `abc` can't be typed, but a user pasting `,,,` ends up with `,,,` → `Number(',,,')` = NaN → silent discard.

**Fix:**
Add an inline error or shake-the-input UX:
```ts
function commitEdit() {
  if (draft.trim() === '') {
    setGoal(null);
    writeGoal(null);
    setEditing(false);
    return;
  }
  const n = Number(draft.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) {
    // Show inline error, don't close the editor.
    setError('הזן מספר חיובי');
    return;
  }
  setGoal(n);
  writeGoal(n);
  setEditing(false);
}
```

Alternatively, fall back to keeping the editor open without any error message — better than silent discard.

---

## Verification of Prior Findings

Confirming each of the 22 prior findings was correctly addressed:

**CR-01 — concurrent upsert serialization via `append`**: ❌ See CR2-01 above. Original race (cross-key) fixed, but introduced a NEW critical regression for same-key concurrent appends. The fix's docstring claim that "subsequent reads dedupe rather than destroying either write" is incorrect — reads do not dedupe, and writes silently shadow themselves through `findIndex` finding the first duplicate while reads return the last duplicate.

**CR-02 — cloud-cleared vs cloud-empty in hydrate**: ✅ Correctly fixed. `hasOwnProperty.call(cloud, cloudKey)` distinguishes the two cases; `removeLocal` + `dispatchChange` mirrors deletion locally. Verified the full path: `writeGoal(null)` → `pushCloudKey(KEY, null)` → POST body has `value: null` → `body.value ?? null` evaluates to `null` → `upsertDashboardStateKey(KEY, null)` stringifies to `"null"` → sheet row has column B = `"null"` → `fetchDashboardState` parses `"null"` back to JS `null` → `kv[KEY] = null` → hydrate's `cloudVal === null` branch triggers `removeLocal`. Note: a sibling edge case for `cloudVal === undefined` is captured in WR2-04.

**CR-03 — `lastPushAt` marked immediately before debounce timer**: ✅ Correctly fixed. Belt (`pendingTimers[lsKey]` short-circuit at cloudSync.ts:236) and suspenders (`lastPushAt[lsKey]` grace window at line 239) both protect uncommitted edits across the 400ms debounce. Traced the race: at any point in the 400ms window, either `pendingTimers[lsKey]` is truthy (timer is still pending) OR `lastPushAt[lsKey]` was just set (immediately, line 145) OR was refreshed inside the timer (line 151). Hydrate's check at line 236/239 catches every state.

**CR-04 — Shopify GraphQL `body.errors` parsing**: ✅ Correctly fixed end-to-end. `getShopifyPlan` returns `{plan, error}`; error string uses `JSON.stringify(body.errors).slice(0, 400)` (bounded, no truncation issues for cell-size limits — Google Sheets supports ~50K chars/cell). `writeStoreMetaRow_` writes to column G. `fetchStoreMeta` coerces undefined/null/empty to null at the type boundary. `BillingSettings` filters `planErrorStores` by `!!m.lastError` and renders the message in `font-mono break-words` (React-escaped, no XSS).

**WR-01 — pendingKeys increment before migration POST**: ✅ Correctly fixed (cloudSync.ts:253-256).

**WR-02 — billing seed gated on partner cloud writes**: ⚠️ Partially fixed — the WR2-02 race window still exists. The fix narrows but doesn't close it.

**WR-03 — block manual re-sync clicks while in flight**: ✅ Correctly fixed (SyncIndicator.tsx:70).

**WR-04 — functional updates for sync-state**: ✅ Correctly fixed via `updateSyncState`.

**WR-05 — Accept header on Shopify GraphQL**: ✅ Correctly fixed (Shopify.gs:287).

**WR-06 — sanitize sheets errors**: ✅ Correctly fixed in both routes.

**WR-07 — CSV escape parsing**: ✅ Correctly fixed (billing.ts:480-504).

**WR-08 — DMY/MDY locale heuristic**: ✅ Correctly fixed with currency-column detection + ambiguity warning.

**WR-09 — typed `StateKey` on `pushCloudKey`**: ✅ Correctly fixed.

**WR-10 — preserve typed draft on cancel**: ✅ Correctly fixed for both `RecurringEditForm` and `OneTimeEditForm`.

**WR-11 — centralized USD→CAD**: ✅ Correctly fixed via `lib/constants.ts` `FROZEN_USD_TO_CAD`. Naming follows convention (SCREAMING_SNAKE_CASE for constants), file is small and well-documented.

**IN-01 through IN-07**: ✅ All correctly addressed per git log.

---

_Reviewed: 2026-05-16T21:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

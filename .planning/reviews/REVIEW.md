---
phase: reviews
reviewed: 2026-05-16T17:41:36Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - Config.gs
  - DailyUpdate.gs
  - SheetBuilder.gs
  - Shopify.gs
  - dashboard-web/src/app/api/dashboard-state/route.ts
  - dashboard-web/src/app/api/store-meta/route.ts
  - dashboard-web/src/components/BillingSettings.tsx
  - dashboard-web/src/components/CloudSync.tsx
  - dashboard-web/src/components/Dashboard.tsx
  - dashboard-web/src/components/GoalTracker.tsx
  - dashboard-web/src/components/InsightsBoard.tsx
  - dashboard-web/src/components/SyncIndicator.tsx
  - dashboard-web/src/lib/analytics.ts
  - dashboard-web/src/lib/annotations.ts
  - dashboard-web/src/lib/billing.ts
  - dashboard-web/src/lib/cloudSync.ts
  - dashboard-web/src/lib/insights.ts
  - dashboard-web/src/lib/sheets.ts
counts:
  critical: 4
  warning: 11
  info: 7
  total: 22
status: issues_found
---

# Code Review Report

**Reviewed:** 2026-05-16T17:41:36Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

The cloud-sync layer has the structure to do its job but several real race conditions and a clear data-loss bug in the upsert path. The user's hunches about `pendingKeys` going stale and the seed listener firing late are confirmed, plus three concurrency bugs they didn't flag. The Apps Script `getShopifyPlan` doesn't read `body.errors` (silent failure on insufficient scope), and `deltaPct` is correct as written. The most urgent finding is BLOCKER CR-01: two concurrent POSTs for different missing keys collide at the same target row and one silently overwrites the other.

## BLOCKER Issues

### CR-01: `upsertDashboardStateKey` loses data on concurrent writes to different missing keys

**File:** `dashboard-web/src/lib/sheets.ts:245-271`
**Issue:**
The upsert reads column A, then computes `targetRow = existingIdx >= 0 ? existingIdx + 2 : keys.length + 2`. For any key that does NOT already exist in the sheet, this resolves to the row *after* the current last row. If two POSTs for two different missing keys (e.g., `billing-recurring` and `annotations`) arrive within the same read window, both compute the same `targetRow = N + 2` and both write to that row. The later write silently overwrites the earlier one — that key's value is gone, and the partner's UI on another device will hydrate the survivor and stomp local state via `writeLocal` + `dispatchChange`.

This is reachable today: the dashboard mounts → `<CloudSync />` fires `hydrateFromCloud()` → the for-loop at lines 190-208 calls `postWithRetry` directly (not the debounced path) for every key whose cloud value is null but local is non-null. On first-run migration this fires up to 5 POSTs in parallel, all racing for the same missing-row slot.

Prompt asked whether the read-then-write race is "exploited correctly" — it is for two writes to the *same* key (last-write-wins is acceptable per the comment on line 240-243), but it is NOT safe for writes to *different* missing keys.

**Fix:**
Serialize writes with a script-lock equivalent, or do a single batchUpdate with all key/value pairs, or use `spreadsheets.values.append` for new keys instead of `update` so the API allocates the row atomically:
```ts
// Atomic append for new keys, update for existing.
if (existingIdx >= 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${STATE_TAB}!A${existingIdx + 2}:C${existingIdx + 2}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[key, json, updatedAt]] },
  });
} else {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${STATE_TAB}!A:C`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[key, json, updatedAt]] },
  });
}
```
This eliminates the calculated-row race entirely for new keys. For same-key concurrent updates the existing last-write-wins remains acceptable.

---

### CR-02: Goal deletion (`writeGoal(null)`) silently never propagates cross-device

**File:** `dashboard-web/src/lib/cloudSync.ts:200-208` and `dashboard-web/src/lib/insights.ts:533-547`
**Issue:**
`writeGoal(null)` removes localStorage and pushes `null` to the cloud. The POST handler stores it as the string `"null"` in column B; `fetchDashboardState` parses it back to JavaScript `null` and the kv map contains `monthly-revenue-goal: null`. On another device, `hydrateFromCloud` checks `if (cloudVal === undefined || cloudVal === null)` (line 200) and conflates "cloud explicitly cleared" with "cloud empty — first-time migration". It then reads local state, and if Device B still has a stale goal, **pushes the stale goal back up to cloud**, undoing the deletion on Device A.

Two failure modes:
1. Partner deletes goal on Device A → Device B's poll arrives → sees null → reads local stale goal → POSTs it → cloud goal restored to the value Device A just removed.
2. User deletes goal on Device A → re-opens dashboard on Device A within 8s grace — fine because of `lastPushAt`. After 8s, any device poll re-pushes the stale local state from another tab/window if open.

The same applies to any other key that needs to support deletion (a future feature like "remove all annotations" would hit this).

**Fix:**
Distinguish "cloud explicitly cleared" from "cloud never written":
```ts
// In sheets.ts return shape, include explicit set of cleared keys.
// Or: write a tombstone object instead of null.
// Minimal fix: treat `null` in cloud as authoritative "user cleared", and only
// migrate when the cloud key is genuinely absent.
const cloudHas = Object.prototype.hasOwnProperty.call(cloud, cloudKey);
if (!cloudHas) {
  // first-time migration path...
} else if (cloudVal === null) {
  // explicit clear — mirror to local
  writeLocal(lsKey, null); // or removeItem
  dispatchChange(lsKey);
  continue;
}
```
Also update `writeLocal` and the per-key readers to treat null as "remove".

---

### CR-03: `hydrateFromCloud` races with pending debounced pushes, can stomp uncommitted edits

**File:** `dashboard-web/src/lib/cloudSync.ts:104-122` and `:188-213`
**Issue:**
`pushCloudKey` only sets `lastPushAt[lsKey] = Date.now()` *inside the setTimeout callback* at line 119 — i.e., after the 400 ms debounce expires. Between the moment the user types/saves and the moment the timer fires, `lastPushAt` for that key is `undefined`. If the 30 s poll or a window-focus `hydrateFromCloud()` runs during this window, the grace-window check at line 196 (`lastPushAt[lsKey] && Date.now() - lastPushAt[lsKey] < HYDRATE_GRACE_MS`) does not block the overwrite — the value is undefined, so the falsy short-circuit lets the overwrite proceed. The hydrate then overwrites localStorage with the cloud's stale value AND fires `dispatchChange`, which causes components to re-render with the wrong state. The pending timer then fires 400 ms later and pushes the now-overwritten "stale" value back to cloud — the user's edit is lost server-side too.

Reproduction: user types a billing edit → blurs the input → debounce starts → window loses focus → user clicks back → focus listener calls `hydrateFromCloud()` → cloud returns prior value → local is overwritten → timer fires → cloud is overwritten with prior value. Net: user's edit silently vanishes.

**Fix:**
Track pending state separately from completed pushes:
```ts
export function pushCloudKey(localStorageKey: string, value: unknown): void {
  // ...
  lastPushAt[localStorageKey] = Date.now(); // mark immediately, not in timer
  pendingTimers[localStorageKey] = setTimeout(() => {
    pendingTimers[localStorageKey] = undefined;
    lastPushAt[localStorageKey] = Date.now(); // refresh on send
    void postWithRetry(cloudKey, value);
  }, 400);
}
```
Or in `hydrateFromCloud`, also skip keys with a pending timer:
```ts
if (pendingTimers[lsKey] || (lastPushAt[lsKey] && Date.now() - lastPushAt[lsKey] < HYDRATE_GRACE_MS)) {
  continue;
}
```

---

### CR-04: Apps Script `getShopifyPlan` ignores `body.errors`, hides scope/auth failures as "missing plan"

**File:** `Shopify.gs:272-292`
**Issue:**
GraphQL responses always return HTTP 200 even when the query fails — Shopify returns `{"errors": [{"message": "Access denied for plan field", "extensions": {...}}]}` with no `data` field. The current code only checks `body.data.shop.plan` and logs `"missing plan in response"`. The actual root cause (missing `read_shop` scope, expired token, account suspension) is silently swallowed, and the store-meta tab keeps writing empty plan names while the user wonders why auto-detect doesn't work.

This also affects `refreshAllStoreMeta()` — it claims to be the source of truth for the dashboard's auto-detect feature, but it can fail invisibly for the lifetime of the deployment.

**Fix:**
```js
const body = JSON.parse(res.getContentText());
if (body && body.errors && body.errors.length) {
  Logger.log(`Shopify plan ${storeId} GraphQL errors: ${JSON.stringify(body.errors)}`);
  return null;
}
const plan = body && body.data && body.data.shop && body.data.shop.plan;
if (!plan || !plan.displayName) {
  Logger.log(`Shopify plan ${storeId}: missing plan in response: ${res.getContentText()}`);
  return null;
}
```

## Warnings

### WR-01: `pendingKeys` counter drifts when `hydrateFromCloud` triggers migration pushes

**File:** `dashboard-web/src/lib/cloudSync.ts:200-208`
**Issue:**
The first-time-migration path at line 205 calls `postWithRetry(cloudKey, local)` directly. It bypasses `pushCloudKey`, so `pendingKeys` is never incremented for these POSTs. On success or final failure, `postWithRetry` decrements via `Math.max(0, syncState.pendingKeys - 1)`. With `Math.max` the value clamps at 0, but it does drift below the actual pending count. If a real `pushCloudKey` is in flight simultaneously, the SyncIndicator pill displays the wrong count ("שומר 2…" while 3 are actually pending). The "ok" transition at line 139-144 (`nextPending === 0`) can also fire prematurely, claiming sync is done when migration POSTs are still flying.

**Fix:**
Either route migration pushes through `pushCloudKey` (debounced) or manually increment before calling `postWithRetry`:
```ts
if (local !== null) {
  lastPushAt[lsKey] = Date.now();
  setSyncState({ status: 'syncing', pendingKeys: syncState.pendingKeys + 1 });
  void postWithRetry(cloudKey, local);
}
```

---

### WR-02: BillingSettings seed can still fire after partner pushes data

**File:** `dashboard-web/src/components/BillingSettings.tsx:111-135`
**Issue:**
The `maybeSeed` listener uses `{once: true}`. On mount, `isHydrated()` may return false, so the listener registers. The FIRST `hydrateFromCloud` completes and dispatches `roas-cloud-hydrated`. `maybeSeed` runs. `hasAnyBilling()` reads localStorage at that moment. If the partner pushed data to cloud BETWEEN component mount and that first hydrate, the hydrate's writeLocal at sheets.ts will populate billing — and the order in `hydrateFromCloud` is `writeLocal` → `dispatchChange` per key → `roas-cloud-hydrated` AFTER the loop. So `hasAnyBilling()` at the moment of `maybeSeed` will see the partner's data. OK so far.

BUT: if the partner pushes AFTER the first hydrate completes (hydrated flag already true, `roas-cloud-hydrated` already fired), the next 30 s poll's writeLocal updates localStorage and dispatches `roas-billing-changed` (good — UI re-reads). However, the **second** hydrate does NOT re-dispatch `roas-cloud-hydrated` because of the `if (!hydrated)` check at line 220. So the original `{once:true}` listener has already fired with whatever state existed at the FIRST hydrate. If that first hydrate found empty cloud AND empty local, it seeded — and pushed the seed up. Now when the partner's data arrives in the second hydrate, the seed has already been written.

So if partner edits arrive after the local-empty seed already pushed, we still don't double-seed (`hasAnyBilling()` is true the second time). BUT the partner's data can collide with the freshly-pushed seed on the server side (different `id`s — both partner's row and seed's row coexist with the same store), creating duplicate "Email Service" rows in the user's recurring list.

**Fix:**
Don't auto-seed from a client at all — let a backend admin job do it, or seed only after `hydrated && !hasAnyBilling()` and write through a guarded endpoint that fails if cloud has any data:
```ts
function maybeSeed() {
  if (!isHydrated()) return; // wait
  if (hasAnyBilling()) return;
  // Re-check cloud one more time before seeding to avoid duplicate-with-partner.
  fetch('/api/dashboard-state').then(r => r.json()).then(d => {
    if (d.kv?.['billing-recurring']) return;
    seedBillingIfEmpty(storeNames);
    setRecurring(readRecurring());
    setOneTime(readOneTime());
  });
}
```

---

### WR-03: SyncIndicator click in `idle`/`ok` state can trigger continuous cloud writes

**File:** `dashboard-web/src/components/SyncIndicator.tsx:52-59`
**Issue:**
When the pill is in `idle` or `ok` state, clicking calls `hydrateFromCloud()`. If the cloud is empty for any key but localStorage has data, the migration path at cloudSync.ts:205 fires a POST. The user can click the pill repeatedly — each click triggers another hydrate, another migration POST per empty key. On a fresh deployment with 5 empty keys, each click sends 5 POSTs. There's no loop in the strict sense (state will be set to syncing then ok), but the rate-limit potential is real and the action is non-idempotent in the migration window.

Even after the first successful migration push, `lastPushAt[lsKey]` is set, so subsequent clicks within 8 s are blocked by the grace window. After 8 s, if cloud still hasn't propagated the value (sheet caching, eventual consistency), the migration path re-fires. The user discovered this is the path that got them rescued from silent failures, so the click intent is well-meaning, but the feedback loop is unbounded.

**Fix:**
Either gate the click on `pendingKeys > 0`/`status !== 'syncing'`, or split the action: idle-click only re-reads (`hydrateFromCloud` with no migration push), and error-click re-pushes via a dedicated endpoint:
```ts
function onClick() {
  if (status === 'error') { setExpanded(v => !v); return; }
  if (status === 'syncing') return; // already in flight
  void hydrateFromCloud();
}
```

---

### WR-04: `pendingKeys` decrement is not atomic across concurrent `postWithRetry` resolutions

**File:** `dashboard-web/src/lib/cloudSync.ts:138-144` and `:148-155`
**Issue:**
`postWithRetry` does `Math.max(0, syncState.pendingKeys - 1)` to decrement, then `setSyncState({pendingKeys: nextPending})`. If two pushes resolve at nearly the same microtask, both can read the same `syncState.pendingKeys = 2`, both compute `nextPending = 1`, and the counter ends at 1 instead of 0. The setSyncState calls are not atomic w.r.t. the read.

Practical impact: the indicator briefly shows "שומר 1…" when nothing is actually pending. Combined with WR-01, the counter is unreliable in any scenario with concurrent pushes.

**Fix:**
Use a functional update via a single source of truth, or compute the count from the actual `pendingTimers` map at read time:
```ts
function pendingCount(): number {
  return Object.values(pendingTimers).filter(Boolean).length;
}
// Then everywhere: setSyncState({ pendingKeys: pendingCount() })
```

---

### WR-05: Apps Script `Shopify.gs` `getShopifyPlan` request omits `Content-Type` and `Accept` headers

**File:** `Shopify.gs:272-278`
**Issue:**
The GraphQL POST uses `contentType: 'application/json'` (top-level option) but does NOT set headers other than the access token. Shopify's GraphQL endpoint typically returns JSON, but some endpoints have been observed returning XML or HTML error pages when the request is malformed. The current code calls `JSON.parse` on the response unconditionally — on a non-JSON 200 (rare but documented on Shopify's status page during incidents), `JSON.parse` throws SyntaxError, which is caught by `refreshAllStoreMeta` and silently logged. Combined with CR-04, that's two layers of silent failure.

**Fix:**
Explicitly set Accept header and guard the JSON parse:
```js
const res = fetchWithRetry_(url, {
  method: 'post',
  contentType: 'application/json',
  headers: {
    'X-Shopify-Access-Token': token,
    'Accept': 'application/json',
  },
  payload: JSON.stringify({ query: query }),
  muteHttpExceptions: true,
});
const text = res.getContentText();
let body;
try { body = JSON.parse(text); }
catch (e) {
  Logger.log(`Shopify plan ${storeId}: non-JSON response: ${text.slice(0, 200)}`);
  return null;
}
```

---

### WR-06: Service-account errors propagated to client may include spreadsheet ID and email

**File:** `dashboard-web/src/app/api/dashboard-state/route.ts:21-25,36-40`
**Issue:**
On any sheet error, both GET and POST handlers return `err.message` verbatim in the JSON response. `SyncIndicator.tsx` (line 86) then renders this string in the popover with `font-mono break-words`. Google API errors regularly include:
- The spreadsheet ID (e.g., `"Requested entity '1Bz...' was not found"`)
- The service account email (e.g., `"sheets-bot@project.iam.gserviceaccount.com does not have permission"`)
- API endpoint paths

The private key itself is never echoed. The leaked items aren't critical secrets but are not meant for an end-user UI either; they help an attacker who has UI access map your infra. Also a UX issue — Hebrew-speaking partners see English Google error stack content.

**Fix:**
Sanitize/abstract error messages before returning:
```ts
function userFacingError(message: string): string {
  if (/permission|forbidden|403/i.test(message)) return 'הסנכרון נכשל: הרשאות אינן מספיקות. ודא ש-Service Account מוגדר כ-Editor על הגיליון.';
  if (/not found|404/i.test(message)) return 'הסנכרון נכשל: הגיליון לא נמצא. בדוק את SPREADSHEET_ID.';
  if (/quota|429/i.test(message)) return 'הסנכרון נכשל: חרגנו ממכסת Google. נסה שוב בעוד דקה.';
  return 'הסנכרון נכשל: שגיאה לא צפויה. בדוק את הלוגים בצד השרת.';
}
// Log the raw message server-side, return the sanitized version to the client.
```

---

### WR-07: `splitCsvLine` mishandles escaped double-quotes inside fields

**File:** `dashboard-web/src/lib/billing.ts:429-446`
**Issue:**
Standard CSV escape for a `"` inside a quoted field is `""`. The current toggle-based parser flips `inQuotes` on each `"`, so a field like `"He said ""hi"""` is parsed as `He said hi""` (or worse, depending on adjacent commas). The post-process `.replace(/^"|"$/g, '')` strips only leading/trailing quotes; embedded mangled quotes remain.

Shopify bill descriptions are unlikely to contain quotes today, but the function is generic CSV import. Quiet corruption of imported descriptions when quotes do appear.

**Fix:**
Implement standard CSV escape handling:
```ts
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
```

---

### WR-08: `normalizeDate` silently misinterprets DD/MM/YYYY (EU locale) as MM/DD/YYYY

**File:** `dashboard-web/src/lib/billing.ts:449-461`
**Issue:**
The slash-format branch unconditionally treats the first segment as month and second as day. Shopify bills from EU storefronts (or some Canadian regions with non-US locale) use DD/MM/YYYY. A bill on 03/04/2026 would be parsed as March 4 instead of April 3 — silently, with no warning. Costs get attributed to the wrong month in the P&L.

**Fix:**
Detect locale via a hint (e.g., another column in the CSV) or require the user to confirm format on import. Minimum: warn if either of the first two digits exceeds 12, indicating ambiguity is resolved one way; otherwise add a heuristic check using the order of dates across all rows (most recent date should be max of values seen).

---

### WR-09: `STATE_KEYS` is closed — new cloud-sync keys silently won't hydrate

**File:** `dashboard-web/src/lib/cloudSync.ts:38-44`
**Issue:**
`STATE_KEYS` is a const tuple of five keys. `pushCloudKey` accepts any string and POSTs it correctly — but `hydrateFromCloud` only iterates `STATE_KEYS`, so a new key added by a future developer (e.g., `roas-dashboard:pinned-stores`) would push to cloud and never pull back. The push-side type is open, the pull-side type is closed — an asymmetry the type system doesn't catch because `pushCloudKey`'s first parameter is `string`.

**Fix:**
Either make `pushCloudKey` accept only `StateKey` (typed), or build the list of keys to hydrate dynamically from whatever's in the cloud kv map:
```ts
for (const [cloudKey, cloudVal] of Object.entries(cloud)) {
  const lsKey = `roas-dashboard:${cloudKey}`;
  if (!STATE_KEYS.includes(lsKey as StateKey)) continue; // or process anyway
  // ...
}
```

---

### WR-10: `RecurringEditForm.onCancel` removes the row even if user typed a draft name

**File:** `dashboard-web/src/components/BillingSettings.tsx:454-457`
**Issue:**
When the user clicks `addNew`, an empty row is created and editing opens. The user types a name in the form's local `name` state, then hits Escape (or clicks ביטול). `onCancel` checks `!r.name` — but `r` is the original item from `items`, whose `name` is still `''` because `commit()` never ran. The row gets removed, the user's typed name is lost without any confirmation.

The same applies in `OneTimeEditForm` (line 708-711) where `!r.description` triggers removal.

**Fix:**
Track whether the user has typed something and confirm before discarding, or simply commit non-empty drafts on cancel:
```tsx
onCancel={() => {
  // Save the local draft so the user doesn't lose work.
  if (!r.name && !name.trim()) remove(r.id);
  else if (!r.name) update(r.id, { name: name.trim() });
  setEditing(null);
}}
```

---

### WR-11: USD→CAD FX is hardcoded at 1.36 in three different places, drifts from live rate

**File:** `dashboard-web/src/lib/billing.ts:249,337` and `dashboard-web/src/components/BillingSettings.tsx:325,344`
**Issue:**
`shopifyPlanCadForName(planName, usdToCad = 1.36)`, the CSV import converter at line 337, and the help text on lines 325 and 344 all bake in 1.36 as the USD→CAD rate. Apps Script fetches a live rate via `getFxRate` and uses it for the daily Spend/Revenue math — so the dashboard's "real" numbers use today's FX while the Plan price suggestions use a stale figure. A 5% FX drift means the suggested monthly Shopify cost is off by ~$5/store/mo. Compounded across stores and months, the P&L drifts.

**Fix:**
Plumb the live `usdToCad` from `/api/data` (or expose a dedicated endpoint) and pass into `shopifyPlanCadForName`. At minimum, centralize the constant and document the date it was last updated:
```ts
// dashboard-web/src/lib/constants.ts
/** Frozen USD/CAD rate used for Shopify plan suggestion math.
 *  Re-check quarterly. Live FX is used for actual ad spend conversion. */
export const FROZEN_USD_TO_CAD = 1.36;
```

## Info

### IN-01: `Aggregate.cogsCoverage` is now always 1.0 — dead metric

**File:** `dashboard-web/src/lib/sheets.ts:103-105` and `dashboard-web/src/lib/analytics.ts:65-66,100`
**Issue:**
`sheets.ts` line 103 always computes `cogs = revenue * 0.25` and sets `hasCogs = true` for every row, deliberately ignoring the COGS column. The aggregate's `cogsCoverage = cogsRows / rows.length` will always equal 1.0 for non-empty inputs. The metric is referenced in `Aggregate` but adds no signal.

**Fix:**
Either drop `cogsCoverage` from `Aggregate` and any UI display, or restore it by reading the actual sheet COGS column for rows where it's populated and only deriving for the rest.

---

### IN-02: `forecastMonthEnd` declared as `... | null` but never returns null

**File:** `dashboard-web/src/lib/insights.ts:447-513` and `dashboard-web/src/components/GoalTracker.tsx:78`
**Issue:**
The function's return type includes `| null`, but every branch returns the object. The `if (!forecast) return null` in GoalTracker is dead code. Misleading typing — readers may assume there's a null branch they need to handle.

**Fix:**
Drop `| null` from the return type, or add an early-return for the case `rows.length === 0`.

---

### IN-03: `HomeTab` `filtered` type uses a TypeScript no-op trick

**File:** `dashboard-web/src/components/Dashboard.tsx:214`
**Issue:**
`NonNullable<ReturnType<typeof Dashboard> extends infer _ ? never : never>` evaluates to `NonNullable<never>` which is `never`. So `never | { ... }` simplifies to the object alone. The construct adds no constraint; it's just obfuscation. A reader has to think for a minute to see it does nothing.

**Fix:**
Replace with the plain object type or extract a named interface:
```tsx
type FilteredView = {
  curAgg: ReturnType<typeof aggregate>;
  prevAgg: ReturnType<typeof aggregate>;
  storeAggs: ReturnType<typeof aggregateByStore>;
  series: ReturnType<typeof dailySeries>;
  visibleStores: string[];
  cur: DashboardData['rows'];
};
```

---

### IN-04: `dynamic = 'force-dynamic'` conflicts with `revalidate` and Cache-Control headers

**File:** `dashboard-web/src/app/api/store-meta/route.ts:6-7` and `dashboard-web/src/app/api/dashboard-state/route.ts:6,14-18`
**Issue:**
`force-dynamic` opts the route into per-request execution and Next.js typically sets `Cache-Control: no-store, must-revalidate` automatically. The hand-set `Cache-Control: public, s-maxage=10, stale-while-revalidate=60` and the `revalidate = 3600` are likely ignored. The intent is unclear; readers will trip on which one wins.

**Fix:**
Pick one model. If you want CDN caching with revalidation, drop `force-dynamic` and use `revalidate = N`. If you want every request to hit origin, drop both `revalidate` and the Cache-Control header.

---

### IN-05: `SyncIndicator` title text doesn't tick — stale "synced X seconds ago"

**File:** `dashboard-web/src/components/SyncIndicator.tsx:44-47`
**Issue:**
The title is computed at render time. The component only re-renders on `roas-cloud-sync-state`. Between events (up to 30 s), the tooltip claims "sync OK • לפני 0ש" when in reality it's been longer. Minor UX issue.

**Fix:**
Add an interval timer in `useEffect` to force re-render every 30 s, or omit the precise time from the tooltip.

---

### IN-06: `BillingSettings` `useEffect` depends on `storeNames` array reference

**File:** `dashboard-web/src/components/BillingSettings.tsx:111-135`
**Issue:**
The effect's dep array is `[storeNames]`. The parent `Dashboard.tsx:271` passes `data.stores` directly — SWR returns a new array reference on each refetch (every 60 s). The effect re-runs every minute, re-registering listeners. The cleanup correctly removes the prior listeners, so no leak, but the effect is more expensive than necessary and `setRecurring`/`setOneTime` re-run causing wasted re-renders.

**Fix:**
Memoize the store list or compare deeply:
```ts
const storeNamesKey = storeNames.join('|');
useEffect(() => { /* ... */ }, [storeNamesKey]);
```

---

### IN-07: Empty `address-style` ESLint suppression comment but no eslint config visible

**File:** `dashboard-web/src/lib/cloudSync.ts:148`
**Issue:**
`// eslint-disable-next-line no-console` exists in the push failure handler. Fine in isolation, but `console.error` is used elsewhere (e.g., dashboard-state/route.ts:23,38) without the suppression. Either the rule isn't actually configured, or coverage is inconsistent. Surfaces as a minor inconsistency.

**Fix:**
Verify ESLint config and either remove the suppression (if the rule isn't enforced) or add it consistently where needed.

---

_Reviewed: 2026-05-16T17:41:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

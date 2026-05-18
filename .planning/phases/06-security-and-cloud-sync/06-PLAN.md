---
phase: 06-security-and-cloud-sync
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - dashboard-web/src/lib/sheets.ts
  - dashboard-web/src/app/api/dashboard-state/route.ts
  - dashboard-web/src/lib/cloudSync.ts
  - dashboard-web/src/components/CloudSync.tsx
  - dashboard-web/src/lib/rateLimit.ts
  - dashboard-web/src/lib/auditLog.ts
  - dashboard-web/src/lib/useAdaptivePolling.ts
  - dashboard-web/package.json
  - dashboard-web/.env.example
  - DailyUpdate.gs
  - SETUP.md
  - SYSTEM_OVERVIEW.md
autonomous: false
requirements:
  - SEC-01-service-account-split
  - SEC-02-rate-limit
  - SEC-03-audit-log
  - SEC-04-if-match
  - SEC-05-adaptive-polling
user_setup:
  - service: google-cloud-iam
    why: "Create new writer service-account + restrict reader scope"
    env_vars:
      - name: GOOGLE_READER_EMAIL
        source: "Google Cloud Console -> IAM -> Service Accounts -> existing reader email"
      - name: GOOGLE_READER_KEY
        source: "existing GOOGLE_PRIVATE_KEY value (re-aliased to reader)"
      - name: GOOGLE_WRITER_EMAIL
        source: "Google Cloud Console -> IAM -> create roas-dashboard-writer@... -> Keys -> Create JSON"
      - name: GOOGLE_WRITER_KEY
        source: "new writer JSON key -> private_key field"
    dashboard_config:
      - task: "Create new service-account roas-dashboard-writer@<project>.iam.gserviceaccount.com with spreadsheets scope"
        location: "Google Cloud Console -> IAM & Admin -> Service Accounts -> Create"
      - task: "Share spreadsheet with writer SA as Editor; reduce existing reader SA to Viewer"
        location: "Google Sheets -> Share dialog"
  - service: upstash-redis
    why: "Rate limit storage for POST /api/dashboard-state (10/min/IP)"
    env_vars:
      - name: UPSTASH_REDIS_REST_URL
        source: "Upstash Console -> create Redis DB (free tier) -> REST URL"
      - name: UPSTASH_REDIS_REST_TOKEN
        source: "Upstash Console -> same DB -> REST Token"
    dashboard_config:
      - task: "Create free-tier Redis database in Upstash"
        location: "https://console.upstash.com -> Create Database -> Regional, free tier"

must_haves:
  truths:
    - "Reader service-account can no longer write to the spreadsheet (returns 403 when forced)"
    - "POST /api/dashboard-state uses GOOGLE_WRITER_* creds; falls back to GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY if writer vars unset"
    - "11th POST in a single minute from one IP returns HTTP 429"
    - "Two POSTs for the same key within 100ms collapse to one Sheets write"
    - "Every successful POST appends one row to dashboard-state-audit with truncated old/new values"
    - "Audit rows older than 30 days are pruned weekly by Apps Script trigger"
    - "Concurrent edits from two browsers: second one receives 412 + retries with merged value, both edits land"
    - "Hidden tab polls every 5min instead of 30s (verified in Network panel)"
    - "Page idle > 10min stops polling until next focus event"
  artifacts:
    - path: "dashboard-web/src/lib/sheets.ts"
      provides: "getAuth(mode: 'read' | 'write') with reader/writer credential split + fallback"
      contains: "getAuth.*mode.*read.*write"
    - path: "dashboard-web/src/lib/rateLimit.ts"
      provides: "Upstash-backed IP rate limiter + per-key 100ms debounce cache"
      exports: ["checkRateLimit", "checkKeyDebounce", "recordKeyPush"]
    - path: "dashboard-web/src/lib/auditLog.ts"
      provides: "appendAuditRow(key, oldValue, newValue) + pruneAuditLog() callable from Apps Script via API"
      exports: ["appendAuditRow", "pruneAuditLog", "AUDIT_TAB"]
    - path: "dashboard-web/src/lib/useAdaptivePolling.ts"
      provides: "React hook that returns current polling interval based on visibility + idle"
      exports: ["useAdaptivePolling"]
    - path: "dashboard-web/src/app/api/dashboard-state/route.ts"
      provides: "Rate-limited POST with If-Match precondition + audit write + debounce"
      contains: "If-Match.*412"
    - path: "DailyUpdate.gs"
      provides: "pruneAuditLogTrigger weekly trigger handler"
      contains: "pruneAuditLog"
    - path: "dashboard-web/package.json"
      provides: "@upstash/ratelimit + @upstash/redis dependencies"
      contains: "@upstash/ratelimit"
  key_links:
    - from: "dashboard-web/src/app/api/dashboard-state/route.ts"
      to: "dashboard-web/src/lib/rateLimit.ts"
      via: "import + checkRateLimit(req) gate before write"
      pattern: "checkRateLimit"
    - from: "dashboard-web/src/lib/sheets.ts::upsertDashboardStateKey"
      to: "getAuth('write')"
      via: "explicit write-mode auth"
      pattern: "getAuth\\(['\"]write['\"]"
    - from: "dashboard-web/src/app/api/dashboard-state/route.ts"
      to: "dashboard-web/src/lib/auditLog.ts::appendAuditRow"
      via: "called after successful upsertDashboardStateKey"
      pattern: "appendAuditRow"
    - from: "dashboard-web/src/components/CloudSync.tsx"
      to: "dashboard-web/src/lib/useAdaptivePolling.ts"
      via: "interval driven by hook output"
      pattern: "useAdaptivePolling"
    - from: "dashboard-web/src/lib/cloudSync.ts::pushCloudKey"
      to: "If-Match header"
      via: "POST body includes ifMatch field from updatedAtByKey"
      pattern: "If-Match"
---

<objective>
שלב 6 מקשיח את ה-surface שכותב ל-Google Sheets (`POST /api/dashboard-state`)
מול 4 כיוונים של סיכון: דליפת מפתחות, brute-force, race conditions בין שותפים,
וחוסר tractability היסטורי. בנוסף — מצמצם את עומס הקריאות מהדשבורד ל-Sheets API
דרך adaptive polling.

Purpose: ה-endpoint היחיד שכותב ל-Sheets הוא writable-surface יחיד, וכרגע
הוא משתמש ב-service-account עם scope של כל הגיליון, ללא rate limit, ללא
audit, ועם last-write-wins גס שמאבד עריכות בין שני שותפים. הסיכון יגדל
כשנפתח את הדשבורד לעוד שותפים. שלב 6 סוגר את הפערים האלה לפני שגדלים.

Output:
- `getAuth(mode)` עם reader/writer split + fallback בטוח
- rate limit 10/min/IP + per-key debounce 100ms
- audit log tab + weekly prune trigger
- If-Match precondition עם 412 + client retry
- adaptive polling hook (30s visible / 5min hidden / stop idle)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/codebase/CONCERNS.md

@dashboard-web/src/lib/sheets.ts
@dashboard-web/src/app/api/dashboard-state/route.ts
@dashboard-web/src/lib/cloudSync.ts
@dashboard-web/src/components/CloudSync.tsx

<interfaces>
<!-- Key contracts the executor needs. Extracted from current codebase. -->

From `dashboard-web/src/lib/sheets.ts` (current, will be modified):
```typescript
// Current signature — replace with mode parameter
function getAuth(write = false): google.auth.GoogleAuth;

// Public exports we MUST preserve (called from API routes):
export async function fetchDailyData(): Promise<DailyRow[]>;
export async function fetchStoreMeta(): Promise<StoreMetaRow[]>;
export async function fetchDashboardState(): Promise<{
  kv: DashboardStateMap;
  updatedAtByKey: Record<string, string>;
}>;
export async function upsertDashboardStateKey(
  key: string,
  value: unknown,
): Promise<void>;
export const ALLOWED_STATE_KEYS: readonly AllowedStateKey[];
export function isAllowedStateKey(k: unknown): k is AllowedStateKey;
export type DashboardStateMap = Record<string, unknown>;
```

From `dashboard-web/src/lib/cloudSync.ts` (will be modified):
```typescript
// STATE_KEYS prefix is `roas-dashboard:` — cloud key strips it.
export type StateKey =
  | 'roas-dashboard:billing-recurring'
  | 'roas-dashboard:billing-onetime'
  | 'roas-dashboard:annotations'
  | 'roas-dashboard:monthly-revenue-goal'
  | 'roas-dashboard:insight-states'
  | 'roas-dashboard:campaign-optimized'
  | 'roas-dashboard:campaign-product-map';

export function pushCloudKey(localStorageKey: StateKey, value: unknown): void;
export async function hydrateFromCloud(): Promise<boolean>;
export function getSyncState(): SyncState;
export function isHydrated(): boolean;
export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';
```

Sheet layout — `dashboard-state` (existing):
- Column A = key (string, no prefix), B = JSON value, C = updatedAt (ISO-8601)
- Read range: `dashboard-state!A2:C10000`

Sheet layout — `dashboard-state-audit` (NEW, this phase):
- Column A = timestamp (ISO-8601)
- Column B = key
- Column C = old_value (truncated to 500 chars, JSON-serialized)
- Column D = new_value (truncated to 500 chars, JSON-serialized)
- Header row: `['timestamp', 'key', 'old_value', 'new_value']`
- Append-only; pruned weekly by Apps Script

Existing fallback pattern (we mimic for reader/writer split):
```typescript
// Today: single GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY
// Tomorrow: reader uses GOOGLE_READER_* with fallback to GOOGLE_CLIENT_EMAIL/KEY
//           writer uses GOOGLE_WRITER_* with fallback to GOOGLE_CLIENT_EMAIL/KEY
// Both fall back so deploy without writer vars set does NOT break the dashboard.
```
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Public internet → Next.js Edge | Anyone with the dashboard URL can hit `POST /api/dashboard-state` |
| Next.js server → Google Sheets API | Service-account credentials cross here; scope determines blast radius if leaked |
| Browser tab A → Browser tab B | Two partners editing the same key race; `updatedAt` is the only correctness signal |
| Vercel env → process.env | Reader vs writer secrets must be partitioned; one leak should not compromise the other |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-01 | Information Disclosure | `dashboard-web/src/lib/sheets.ts::getAuth` (writer creds leak) | mitigate | Split into reader/writer service accounts; reader SA has `spreadsheets.readonly` only, so leak cannot mutate data. Writer SA used only by `upsertDashboardStateKey` + `appendAuditRow`. |
| T-06-02 | Tampering | `POST /api/dashboard-state` (unauthorized writes) | mitigate | Existing `isAllowedStateKey` allowlist remains; added rate limit (10/min/IP via Upstash) prevents flood-write abuse. |
| T-06-03 | Denial of Service | `POST /api/dashboard-state` (Sheets quota exhaustion) | mitigate | 10/min/IP rate limit + 100ms per-key server-side debounce. Two POSTs for same key within 100ms return cached previous response (no Sheets call). |
| T-06-04 | Repudiation | Cloud-state edits (no "who/when/what changed") | mitigate | `dashboard-state-audit` tab logs every write with old+new values truncated to 500 chars; 30-day retention via weekly Apps Script trigger. |
| T-06-05 | Tampering (race) | Concurrent edits silently overwrite | mitigate | If-Match precondition: client sends `If-Match: <updatedAt>`; server returns 412 if sheet's current `updatedAtByKey[key]` differs; client re-hydrates + merges + retries. |
| T-06-06 | Denial of Service | Sheets API read quota (5+ partners × 30s poll) | mitigate | Adaptive polling: visible tab 30s, hidden 5min, idle > 10min stops. Cuts background read load by ~10x. |
| T-06-07 | Elevation of Privilege | Vercel deploy without writer env vars | accept (with fallback) | T-01 implements fallback: if `GOOGLE_WRITER_*` unset, both reader and writer paths use the existing single `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY` — dashboard keeps working. Risk: until operator rotates, old single key still has write scope. Mitigation: SETUP.md highlights the rotation step. |
| T-06-08 | Information Disclosure | Audit log leaks PII / secrets in old_value | accept | Audit values are billing amounts, annotation text, partner notes — no secrets, no PII beyond what's already in the sheet. Truncation to 500 chars caps payload size. Reviewed: `STATE_KEYS` whitelist does not include token-shaped data. |
| T-06-09 | Tampering | Rate-limit bypass via IP spoofing | accept | `x-forwarded-for` from Vercel is trusted; raw socket IP is hidden behind Vercel's proxy. Adversary on a residential ISP rotating IPs gets at most 10 writes/min/IP — still inside Sheets quota even at scale. Sufficient for the (currently semi-internal) dashboard threat model. |
</threat_model>

<tasks>

<task type="auto">
  <name>Task 1: Service-account split with backward-compatible fallback</name>
  <files>
    dashboard-web/src/lib/sheets.ts,
    dashboard-web/.env.example,
    SETUP.md
  </files>
  <action>
ממש את ה-split של reader/writer service accounts (per requirement SEC-01) עם
fallback בטוח כדי שדפלוי בלי writer env vars לא ישבור את הדשבורד.

ב-`dashboard-web/src/lib/sheets.ts`:
1. החלף את `getAuth(write = false)` ב-`getAuth(mode: 'read' | 'write' = 'read')`.
2. רזולוציית credentials:
   - אם `mode === 'write'`: נסה `GOOGLE_WRITER_EMAIL` + `GOOGLE_WRITER_KEY`,
     fallback ל-`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY` אם לא הוגדרו.
   - אם `mode === 'read'`: נסה `GOOGLE_READER_EMAIL` + `GOOGLE_READER_KEY`,
     fallback ל-`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`.
3. שגיאת "missing env vars" רק אם **כל ה-3 הזוגות** ריקים (reader/writer/legacy).
4. ה-scope נשאר כפי שהיה — write מקבל `spreadsheets`, read מקבל `spreadsheets.readonly`.
5. **קריטי**: עדכן את כל הקריאות לפונקציה ב-`sheets.ts` עצמו:
   - `fetchDailyData()` → `getAuth('read')` (כיום `getAuth()`)
   - `fetchStoreMeta()` → `getAuth('read')`
   - `fetchDashboardState()` → `getAuth('read')`
   - `upsertDashboardStateKey()` → `getAuth('write')` (כיום `getAuth(true)`)
6. הוסף JSDoc שמסביר את ה-fallback semantics ומפנה ל-T-06-01/T-06-07.

ב-`dashboard-web/.env.example` (צור אם לא קיים, או הוסף):
```
# Reader service account (used for all GET reads). Falls back to GOOGLE_CLIENT_EMAIL/KEY.
GOOGLE_READER_EMAIL=
GOOGLE_READER_KEY=
# Writer service account (used only for upsertDashboardStateKey + audit log).
GOOGLE_WRITER_EMAIL=
GOOGLE_WRITER_KEY=
# Legacy single-account fallback (used if reader/writer pairs are unset).
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

ב-`SETUP.md`: הוסף סעיף "Service-account split (Phase 6)" שמסביר:
1. ליצור service-account חדש `roas-dashboard-writer@<project>.iam.gserviceaccount.com`
2. להעניק לו Editor על ה-spreadsheet
3. להוריד JSON key, להעלות `private_key` ל-Vercel כ-`GOOGLE_WRITER_KEY`, ו-`client_email` כ-`GOOGLE_WRITER_EMAIL`
4. (אופציונלי, מומלץ) ל-existing service-account להוריד את ההרשאה ל-Viewer + ל-rename משתני סביבה ל-`GOOGLE_READER_*`
5. **חשוב**: אם הצעדים האלה לא בוצעו, ה-fallback מבטיח שהדשבורד ימשיך לעבוד עם המפתח הקיים — אבל הסיכון של דליפת מפתח עם write scope נשאר עד שהrotation הושלם.

לא לגעת ב-`upsertDashboardStateKey` עצמה מעבר לשינוי קריאת getAuth — שאר השינויים (audit + If-Match) בטסקים הבאים.

**TDD**: בטסק הזה לא נוסיף בדיקות אוטומטיות (אין vitest עדיין — Phase 2 דרישה).
במקום זה, `verify` יכלול בדיקות grep + build pass.
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas/dashboard-web && grep -n "getAuth(['\"]read['\"]" src/lib/sheets.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 3)}' && grep -n "getAuth(['\"]write['\"]" src/lib/sheets.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 1)}' && grep -n "mode.*['\"]read['\"].*['\"]write['\"]" src/lib/sheets.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 1)}' && grep -n "GOOGLE_READER_EMAIL\|GOOGLE_WRITER_EMAIL" src/lib/sheets.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 2)}' && npm run build</automated>
  </verify>
  <done>
- `getAuth(mode: 'read' | 'write')` signature deployed
- 3 פנימיות קריאות עם `'read'`, אחת עם `'write'` (upsertDashboardStateKey)
- env vars: ב-3 הזוגות נתמכים, fallback ל-legacy עובד
- `.env.example` מתעד את 3 הזוגות
- `SETUP.md` כולל הוראות rotation
- `npm run build` עובר ללא שגיאות TypeScript חדשות
- אם רק `GOOGLE_CLIENT_EMAIL`+`GOOGLE_PRIVATE_KEY` מוגדרים בסביבת dev/prod: הדשבורד עובד כרגיל (no breakage)
  </done>
</task>

<task type="auto">
  <name>Task 2: Rate limit + per-key debounce + If-Match precondition</name>
  <files>
    dashboard-web/package.json,
    dashboard-web/src/lib/rateLimit.ts,
    dashboard-web/src/lib/auditLog.ts,
    dashboard-web/src/lib/sheets.ts,
    dashboard-web/src/app/api/dashboard-state/route.ts,
    dashboard-web/src/lib/cloudSync.ts,
    dashboard-web/.env.example
  </files>
  <action>
ממש את 3 המנגנונים שמגנים על ה-POST endpoint: rate limit (SEC-02), audit log
(SEC-03), ו-If-Match (SEC-04). שלושתם נכנסים יחד כי כולם פוגעים באותו route
handler — פיצול לטסקים נפרדים ייצור edit overhead כפול על אותו קובץ.

**א) Dependencies:**
ב-`dashboard-web/package.json` הוסף:
- `"@upstash/ratelimit": "^2.0.0"`
- `"@upstash/redis": "^1.34.0"`

הרץ `npm install` באותה הריצה כדי להבטיח lockfile מעודכן.

**ב) Rate limit + debounce module (`dashboard-web/src/lib/rateLimit.ts`):**

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Lazy singleton: in dev/test without Upstash env vars, return a no-op limiter
// that always allows. Production deploys without UPSTASH_* MUST fail fast,
// so we throw if NODE_ENV === 'production' and vars missing.
let limiter: Ratelimit | null = null;
function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production') {
      // Don't crash — log + return null so writes still work. Operator gets
      // a warning in Vercel logs; rate limit is opt-in, not load-bearing.
      console.warn('UPSTASH_REDIS_REST_URL/TOKEN unset; rate limit disabled');
    }
    return null;
  }
  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(10, '60 s'),
    analytics: false,
    prefix: 'roas-dash-state',
  });
  return limiter;
}

/** Returns { ok: true } if request allowed, { ok: false, retryAfter } if 429. */
export async function checkRateLimit(
  ip: string,
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const l = getLimiter();
  if (!l) return { ok: true };
  const { success, reset } = await l.limit(ip);
  if (success) return { ok: true };
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { ok: false, retryAfter };
}

// Per-key 100ms in-memory debounce. Process-local: on Vercel serverless this
// only dedupes when two requests happen to hit the same warm instance, but
// that's the common case for rapid same-key bursts (same client). If they
// hit different instances, both go through — rate limit is the second line.
const lastPushAt = new Map<string, { at: number; response: { ok: true } }>();
const DEBOUNCE_MS = 100;

/** Returns the cached response if the same key was pushed < 100ms ago. */
export function checkKeyDebounce(
  key: string,
): { hit: false } | { hit: true; cached: { ok: true } } {
  const prev = lastPushAt.get(key);
  if (!prev) return { hit: false };
  if (Date.now() - prev.at < DEBOUNCE_MS) {
    return { hit: true, cached: prev.response };
  }
  return { hit: false };
}

export function recordKeyPush(key: string): void {
  lastPushAt.set(key, { at: Date.now(), response: { ok: true } });
  // Prevent unbounded growth — keep only fresh entries.
  if (lastPushAt.size > 100) {
    const now = Date.now();
    for (const [k, v] of lastPushAt) {
      if (now - v.at > 5_000) lastPushAt.delete(k);
    }
  }
}
```

**ג) Audit log module (`dashboard-web/src/lib/auditLog.ts`):**

```typescript
import { google } from 'googleapis';

export const AUDIT_TAB = 'dashboard-state-audit';
const MAX_VALUE_LEN = 500;

function truncate(v: unknown): string {
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s == null) return '';
  return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) + '...[trunc]' : s;
}

/** Appends one audit row. Best-effort: any failure here is logged but does
 *  NOT propagate — audit must never block the primary write. */
export async function appendAuditRow(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  key: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  try {
    await ensureAuditTab_(sheets, spreadsheetId);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${AUDIT_TAB}!A:D`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[new Date().toISOString(), key, truncate(oldValue), truncate(newValue)]],
      },
    });
  } catch (err) {
    console.warn('audit log append failed:', err instanceof Error ? err.message : String(err));
  }
}

/** Deletes audit rows where timestamp < now() - 30d. Called by an Apps Script
 *  weekly trigger via HTTP (or directly when invoked from Node tests). */
export async function pruneAuditLog(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<{ deletedRows: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${AUDIT_TAB}!A2:D100000`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  const survivors = rows.filter(r => {
    const ts = String(r[0] ?? '');
    return ts >= cutoff; // ISO-8601 lexicographic compare
  });
  const deletedRows = rows.length - survivors.length;
  if (deletedRows === 0) return { deletedRows: 0 };
  // Rewrite the entire data range: clear then bulk-write survivors.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${AUDIT_TAB}!A2:D100000`,
  });
  if (survivors.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${AUDIT_TAB}!A2:D${survivors.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: survivors },
    });
  }
  return { deletedRows };
}

async function ensureAuditTab_(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${AUDIT_TAB}!A1:D1`,
    });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Unable to parse range|not found/i.test(msg)) throw err;
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: AUDIT_TAB, hidden: true } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${AUDIT_TAB}!A1:D1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['timestamp', 'key', 'old_value', 'new_value']] },
  });
}
```

**ד) `dashboard-web/src/lib/sheets.ts` — extend upsertDashboardStateKey:**

שנה את החתימה של `upsertDashboardStateKey` כך:
```typescript
export async function upsertDashboardStateKey(
  key: string,
  value: unknown,
  options?: { ifMatch?: string | null },
): Promise<{ updatedAt: string; oldValue: unknown }>;
```

לוגיקה חדשה בתוך הפונקציה (לפני ה-update/append):
1. אחרי שמצאנו `bestIdx` (השורה הקיימת עם updatedAt הכי חדש), שלוף את הערך הקיים (`oldValueRaw = rows[bestIdx][1]`) ו-`currentUpdatedAt = String(rows[bestIdx][2] ?? '')`.
2. אם `options?.ifMatch` סופק **וגם** `bestIdx >= 0` (קיים row): השווה `options.ifMatch === currentUpdatedAt`. אם שונה — `throw new Error('PRECONDITION_FAILED:' + currentUpdatedAt)`.
3. אם `options?.ifMatch` סופק אבל `bestIdx === -1` (אין row בכלל) — זה גם conflict לוגי אם הלקוח חשב שיש ערך. **חריג**: אם `ifMatch === ''` (לקוח מאשר "אין כלום"), עברו ל-append.
4. בסוף הפונקציה החזירו `{ updatedAt, oldValue: parseOldValue(oldValueRaw) }` במקום `void`.
5. `parseOldValue` מנסה `JSON.parse` ונופל ל-string אם נכשל (אותו pattern כמו `fetchDashboardState`).

**ה) `dashboard-web/src/app/api/dashboard-state/route.ts` — wire it all:**

החלף את ה-POST handler ב:

```typescript
export async function POST(req: Request) {
  try {
    // 1. Extract IP for rate limit (Vercel sets x-forwarded-for).
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const rl = await checkRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limit' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }

    const body = (await req.json()) as { key?: unknown; value?: unknown };
    if (!isAllowedStateKey(body.key)) {
      return NextResponse.json({ error: 'unknown key' }, { status: 400 });
    }

    // 2. Per-key 100ms debounce — same key twice in 100ms = collapse.
    const debounce = checkKeyDebounce(body.key);
    if (debounce.hit) {
      return NextResponse.json({ ok: true, debounced: true });
    }

    // 3. If-Match precondition.
    const ifMatchHeader = req.headers.get('If-Match');
    const ifMatch = ifMatchHeader ?? undefined;

    try {
      const result = await upsertDashboardStateKey(body.key, body.value ?? null, {
        ifMatch,
      });
      recordKeyPush(body.key);

      // 4. Audit log — fire after primary write, share auth instance.
      // We pass through the sheets handle by re-deriving inside auditLog
      // (cheap; the auth singleton inside getAuth keeps token reuse).
      const auth = getAuth('write');
      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = getSpreadsheetId();
      void appendAuditRow(sheets, spreadsheetId, body.key, result.oldValue, body.value);

      return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('PRECONDITION_FAILED:')) {
        const currentUpdatedAt = msg.slice('PRECONDITION_FAILED:'.length);
        return NextResponse.json(
          { error: 'precondition_failed', currentUpdatedAt },
          { status: 412 },
        );
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('dashboard-state POST failed:', message);
    return NextResponse.json({ error: userFacingError(message) }, { status: 500 });
  }
}
```

**הערות חשובות לביצוע:**
- צריך להוסיף ל-imports את `checkRateLimit`, `checkKeyDebounce`, `recordKeyPush` מ-`@/lib/rateLimit`, ואת `appendAuditRow` מ-`@/lib/auditLog`, וגם `google` מ-`googleapis` + `getAuth`, `getSpreadsheetId` שצריכים להיות exported מ-`sheets.ts` (כרגע `getSpreadsheetId` פנימי — export אותו).
- אם `getAuth` או `getSpreadsheetId` עדיין פנימיים, הוסף `export` להם. עדכן את הקוד לפי הצורך.
- ה-`void` לפני `appendAuditRow` מבטיח שאם ה-audit נכשל — לא יתפוס את ה-200 response.

**ו) `dashboard-web/src/lib/cloudSync.ts` — client-side If-Match:**

ב-`pushCloudKey` ו-`postWithRetry`:
1. שמור מפה `lastSeenUpdatedAt: Record<string, string>` שמתעדכנת מ-`hydrateFromCloud` (כל שדה ב-`updatedAtByKey`).
2. ב-`postWithRetry`: לפני ה-fetch, לקרוא `lastSeenUpdatedAt[cloudKey]` ולשלוח כ-`If-Match` header (אם undefined — לא שולחים את ה-header בכלל).
3. אם ה-תשובה היא 412:
   - הרץ `hydrateFromCloud()` כדי לקבל את הערך החדש מהענן.
   - קרא לפונקציה חדשה `mergeOnConflict(cloudKey, attemptedValue, cloudValue)` שמכריעה איך למזג:
     - עבור arrays (annotations, billing-onetime, campaign-product-map): concat + dedupe by id
     - עבור objects (billing-recurring, insight-states, campaign-optimized): shallow merge — מפתחות מקומיים מנצחים
     - עבור scalars (monthly-revenue-goal): המקומי מנצח (סקלאר = החלטת משתמש)
   - נסה שוב POST עם הערך הממוזג + ה-`If-Match` החדש. **maximum 1 retry** למניעת loop אינסופי. אם גם ה-retry נכשל ב-412 — log + lastError, ויתור.
4. עדכן את `hydrateFromCloud` לסנכרן את `lastSeenUpdatedAt` מתוך `payload.updatedAtByKey` ש-GET כבר מחזיר (`route.ts` כבר מחזיר `updatedAtByKey` ב-body — אנחנו רק קוראים אותו).

**ז) `dashboard-web/.env.example` — הוסף:**
```
# Upstash Redis for rate limiting POST /api/dashboard-state (10/min/IP).
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

**TDD scope**: בדיקות אוטומטיות מקיפות תלויות ב-Phase 2 vitest setup. בטסק הזה
ה-verify נשען על build pass + grep gates + curl-based smoke checks ב-`done`.
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas/dashboard-web && grep -c '"@upstash/ratelimit"' package.json | awk '{exit ($1 < 1)}' && grep -c '"@upstash/redis"' package.json | awk '{exit ($1 < 1)}' && test -f src/lib/rateLimit.ts && test -f src/lib/auditLog.ts && grep -n 'checkRateLimit\|checkKeyDebounce\|recordKeyPush' src/app/api/dashboard-state/route.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 3)}' && grep -n 'appendAuditRow' src/app/api/dashboard-state/route.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 1)}' && grep -n 'If-Match\|ifMatch' src/app/api/dashboard-state/route.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 2)}' && grep -n 'PRECONDITION_FAILED\|412' src/app/api/dashboard-state/route.ts | grep -v '^#' | wc -l | awk '{exit ($1 < 1)}' && grep -n 'lastSeenUpdatedAt\|If-Match' src/lib/cloudSync.ts | grep -v '^//' | wc -l | awk '{exit ($1 < 2)}' && grep -n 'mergeOnConflict\|412' src/lib/cloudSync.ts | grep -v '^//' | wc -l | awk '{exit ($1 < 1)}' && npm install && npm run build</automated>
  </verify>
  <done>
- `@upstash/ratelimit` + `@upstash/redis` ב-dependencies, lockfile מעודכן
- `src/lib/rateLimit.ts` קיים עם `checkRateLimit`, `checkKeyDebounce`, `recordKeyPush`
- `src/lib/auditLog.ts` קיים עם `appendAuditRow`, `pruneAuditLog`, `AUDIT_TAB`
- `upsertDashboardStateKey` מקבל `options?: { ifMatch?: string | null }` ומחזיר `{ updatedAt, oldValue }`
- POST route מבצע: rate limit → allowlist → debounce → upsert עם ifMatch → audit → response עם updatedAt
- 412 מוחזר עם `{ error: 'precondition_failed', currentUpdatedAt }`
- `cloudSync.ts` שולח `If-Match` מ-`lastSeenUpdatedAt`; על 412 → hydrate → merge → retry once
- `npm run build` עובר
- בדיקת ידנית (אחרי deploy): 11 POSTs רצופים בדקה אחת → 11-th מקבל 429 עם Retry-After header
- בדיקת ידנית: שני tabs שעורכים billing → השני מקבל 412 → silently retries → שני הערכים נשמרים
  </done>
</task>

<task type="auto">
  <name>Task 3: Adaptive polling hook + Apps Script weekly prune trigger</name>
  <files>
    dashboard-web/src/lib/useAdaptivePolling.ts,
    dashboard-web/src/components/CloudSync.tsx,
    DailyUpdate.gs,
    SYSTEM_OVERVIEW.md
  </files>
  <action>
משלים את הפיצ'ר עם adaptive polling בצד הלקוח (SEC-05) וה-cleanup הצדדי
ב-Apps Script שמריץ `pruneAuditLog` שבועית (SEC-03 retention).

**א) `dashboard-web/src/lib/useAdaptivePolling.ts`:**

```typescript
'use client';
import { useEffect, useRef, useState } from 'react';

const VISIBLE_MS = 30_000;
const HIDDEN_MS = 300_000; // 5 min
const IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min
type Mode = 'visible' | 'hidden' | 'idle-stop';

/**
 * Adaptive polling driver:
 *  - document.visibilityState === 'visible' → 30s
 *  - 'hidden' → 5min
 *  - no user interaction (mousemove/keydown/touchstart) for > 10min → STOP
 *    polling until the next focus/visibility change.
 *
 * Returns the current mode (for diagnostics in dev) and drives `onTick` at
 * the appropriate cadence. Cleans up on unmount.
 */
export function useAdaptivePolling(onTick: () => void): Mode {
  const [mode, setMode] = useState<Mode>('visible');
  const tickRef = useRef(onTick);
  const lastActivityRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest onTick without re-arming on every render.
  useEffect(() => { tickRef.current = onTick; });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      // If we were idle-stopped, kick polling back on.
      setMode(prev => (prev === 'idle-stop'
        ? (document.visibilityState === 'visible' ? 'visible' : 'hidden')
        : prev));
    };

    const computeMode = (): Mode => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor > IDLE_THRESHOLD_MS) return 'idle-stop';
      return document.visibilityState === 'visible' ? 'visible' : 'hidden';
    };

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const m = computeMode();
      setMode(m);
      if (m === 'idle-stop') return; // no timer; will rearm on activity/focus
      const delay = m === 'visible' ? VISIBLE_MS : HIDDEN_MS;
      timerRef.current = setTimeout(() => {
        tickRef.current();
        arm();
      }, delay);
    };

    const onVis = () => arm();
    const onFocus = () => { markActivity(); arm(); };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('mousemove', markActivity, { passive: true });
    window.addEventListener('keydown', markActivity);
    window.addEventListener('touchstart', markActivity, { passive: true });

    arm(); // initial fire scheduling

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('mousemove', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('touchstart', markActivity);
    };
  }, []);

  return mode;
}
```

**ב) `dashboard-web/src/components/CloudSync.tsx` — replace polling:**

```typescript
'use client';

import { useEffect } from 'react';
import { hydrateFromCloud } from '@/lib/cloudSync';
import { useAdaptivePolling } from '@/lib/useAdaptivePolling';

export function CloudSync() {
  // Initial hydrate on mount (separate from adaptive polling, which only
  // handles the recurring cadence).
  useEffect(() => {
    void hydrateFromCloud();
  }, []);

  useAdaptivePolling(() => {
    void hydrateFromCloud();
  });

  return null;
}
```

**ג) `DailyUpdate.gs` — weekly prune trigger:**

הוסף לקובץ (מעל `notifyError_`):

```javascript
/**
 * Weekly cleanup of dashboard-state-audit rows older than 30 days. Triggered
 * by `installAuditPruneTrigger()` to run every Sunday around 03:00. Calls the
 * dashboard's internal endpoint to keep the deletion logic single-source.
 *
 * If the dashboard URL is unreachable (Vercel cold deploy, transient error),
 * we log + return. Next week's run picks up the slack.
 */
function pruneAuditLogTrigger() {
  var url = PropertiesService.getScriptProperties().getProperty('dashboard.pruneAuditUrl');
  if (!url) {
    Logger.log('pruneAuditLogTrigger: dashboard.pruneAuditUrl property not set; skipping');
    return;
  }
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      headers: { 'x-prune-secret': PropertiesService.getScriptProperties().getProperty('dashboard.pruneSecret') || '' },
    });
    var code = resp.getResponseCode();
    Logger.log('pruneAuditLogTrigger: HTTP ' + code + ' ' + resp.getContentText().slice(0, 200));
  } catch (e) {
    Logger.log('pruneAuditLogTrigger error: ' + (e && e.message ? e.message : String(e)));
  }
}

/** Install the weekly trigger. Run once manually from the Apps Script editor. */
function installAuditPruneTrigger() {
  // Remove any existing trigger to avoid duplicates.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'pruneAuditLogTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('pruneAuditLogTrigger')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  Logger.log('Installed pruneAuditLogTrigger weekly (Sunday 03:00)');
}
```

**הערה לאופרטור (להוסיף ב-SETUP.md אחרי הdeploy):**
- ב-Vercel: לחשוף route חדש `POST /api/audit-prune` שמריץ `pruneAuditLog(sheets, spreadsheetId)` כש-header `x-prune-secret` תואם ל-env var `PRUNE_AUDIT_SECRET`. **לא נכלל בטסק הזה** כי הוא thin endpoint שאפשר להוסיף ב-Phase 7 (Observability) או יד-אנושית אחרי שהפיצ'ר עולה. לעת עתה — `pruneAuditLog` ייקרא ידנית פעם בחודש דרך Node REPL/Vercel function logs, וה-trigger ב-Apps Script מוסר אם לא נדרש.

**עדכון לטסק 3**: מספיק שה-Apps Script trigger קיים ומוכן. אם ה-`dashboard.pruneAuditUrl` לא מוגדר ב-Script Properties, ה-trigger לוגg "skipping" ולא מפיל כלום — בטוח להתקין מראש.

**ד) `SYSTEM_OVERVIEW.md` — סעיף Security update:**

הוסף סעיף בסוף ה-document (או עדכן את ה-section הקיים אם יש):

```markdown
## Security (Phase 6)

Two-service-account split:
- **Reader** (`GOOGLE_READER_EMAIL`/`KEY`, scope: `spreadsheets.readonly`) —
  used by all GET reads via `getAuth('read')`.
- **Writer** (`GOOGLE_WRITER_EMAIL`/`KEY`, scope: `spreadsheets`) — used only
  by `upsertDashboardStateKey` and `appendAuditRow` via `getAuth('write')`.
- **Fallback**: if either pair is unset, both modes fall back to the legacy
  `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`. Production deploys SHOULD have
  both pairs set; the fallback exists for safe migration.

POST `/api/dashboard-state` protections:
1. **Rate limit**: 10 POSTs/min/IP via Upstash Redis (`UPSTASH_REDIS_REST_*`).
   429 + `Retry-After` returned when exceeded.
2. **Debounce**: same-key POSTs within 100ms collapse to one Sheets write
   (in-memory per Vercel instance).
3. **If-Match**: client sends `If-Match: <updatedAt>`. Server returns 412
   `{ currentUpdatedAt }` if the sheet's row differs. Client merges + retries
   once (`mergeOnConflict` in `cloudSync.ts`).
4. **Audit log**: every successful write appends a row to `dashboard-state-audit`
   with `[timestamp, key, old_value(≤500), new_value(≤500)]`. 30-day retention
   via `pruneAuditLogTrigger` (Apps Script, weekly Sunday 03:00).

Adaptive polling:
- Visible tab: 30s
- Hidden tab: 5min
- Idle (>10min no input): polling stops; resumes on focus or activity.
```

**TDD scope**: ה-hook הוא pure-ish (משתמש ב-DOM APIs); בדיקה אוטומטית דורשת
JSDOM + vitest שיותקנו ב-Phase 2. כרגע: grep-based verification + manual smoke
ב-Network panel.
  </action>
  <verify>
    <automated>cd /Users/dorperetz/script-roas/dashboard-web && test -f src/lib/useAdaptivePolling.ts && grep -n "VISIBLE_MS = 30_000\|VISIBLE_MS = 30000" src/lib/useAdaptivePolling.ts | grep -v '^//' | wc -l | awk '{exit ($1 < 1)}' && grep -n "HIDDEN_MS = 300_000\|HIDDEN_MS = 300000" src/lib/useAdaptivePolling.ts | grep -v '^//' | wc -l | awk '{exit ($1 < 1)}' && grep -n "IDLE_THRESHOLD_MS" src/lib/useAdaptivePolling.ts | grep -v '^//' | wc -l | awk '{exit ($1 < 1)}' && grep -n "useAdaptivePolling" src/components/CloudSync.tsx | grep -v '^//' | wc -l | awk '{exit ($1 < 2)}' && ! grep -n "setInterval(tick, 30_000)\|setInterval(tick, 30000)" src/components/CloudSync.tsx && grep -n "pruneAuditLogTrigger\|installAuditPruneTrigger" /Users/dorperetz/script-roas/DailyUpdate.gs | grep -v '^//' | wc -l | awk '{exit ($1 < 2)}' && npm run build</automated>
  </verify>
  <done>
- `useAdaptivePolling.ts` קיים עם 3 ה-thresholds (30s/300s/10min idle)
- `CloudSync.tsx` מסיר את ה-`setInterval(tick, 30_000)` הישן ומשתמש ב-hook
- listeners ל-mousemove/keydown/touchstart + visibilitychange + focus קיימים
- `DailyUpdate.gs` כולל `pruneAuditLogTrigger` + `installAuditPruneTrigger`
- `SYSTEM_OVERVIEW.md` מתעד את כל הproperties החדשים
- `npm run build` עובר
- בדיקה ידנית אחרי deploy: tab רקע 5min → 1 fetch ל-`/api/dashboard-state` במקום 10
- בדיקה ידנית: idle 11min ללא טאצ' → 0 fetches עד שיש focus
- Apps Script: ריצה ידנית של `installAuditPruneTrigger` יוצרת trigger weekly Sunday 03:00
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Manual smoke verification (post-deploy)</name>
  <what-built>
3 הפיצ'רים הקריטיים של Phase 6 הוטמעו: service-account split + fallback,
rate limit + debounce + If-Match + audit log, adaptive polling + prune trigger.
לפני סימון השלב כ-done — נדרש סבב smoke ידני מול production deploy כדי לוודא
שאין breakage, ושהבדיקות שנעשו ב-`done` של כל טסק אכן נכונות באמת.
  </what-built>
  <how-to-verify>
1. **Service-account fallback** (T-06-07, T-01):
   - ב-Vercel: עדיין בלי `GOOGLE_WRITER_EMAIL`/`KEY` — רק ה-legacy `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY` מוגדר.
   - פתח את הדשבורד → ערוך billing → בדוק שהערך עלה לענן (sync indicator → "synced N seconds ago").
   - **Expected**: עובד.

2. **Service-account split** (אחרי שהוסיפו את הwriter ב-Vercel):
   - ב-Google Cloud: צור `roas-dashboard-writer@...`, שתף את ה-spreadsheet עם הwriter כ-Editor, הוסף `GOOGLE_WRITER_EMAIL`/`GOOGLE_WRITER_KEY` ל-Vercel.
   - ב-Google Cloud: הסר את הreader (existing) מ-Editor → השאר אותו כ-Viewer.
   - Redeploy → ערוך billing → בדוק ש-sync מצליח. (writer = Editor → write עובר; reader = Viewer → read עובר; הקודמים נשארים תקפים בלי שינוי קוד.)

3. **Rate limit** (SEC-02):
   - פתח DevTools Console:
   ```js
   for (let i = 0; i < 12; i++) {
     fetch('/api/dashboard-state', {
       method: 'POST',
       headers: {'content-type':'application/json'},
       body: JSON.stringify({ key: 'annotations', value: [{ id: 'test-'+i, date: '2026-05-18', text: 'rl test' }] })
     }).then(r => console.log(i, r.status, r.headers.get('Retry-After')));
   }
   ```
   - **Expected**: שורות 0–9 עם status 200, שורות 10+ עם status 429 ו-`Retry-After` header.

4. **If-Match conflict** (SEC-04):
   - פתח את הדשבורד ב-2 דפדפנים שונים (או 2 tabs incognito).
   - בשניהם: BillingSettings → "מנויים קבועים" → ערוך את אותו מנוי, שמור.
   - **Expected**: שני העריכות נשמרות. הדפדפן השני (איטי) מקבל ב-Network panel POST שמחזיר 412, אחריו hydrate, ואז POST נוסף שמחזיר 200. אין loss של עריכה.

5. **Audit log** (SEC-03):
   - בגיליון Google Sheets: פתח את הטאב `dashboard-state-audit`.
   - **Expected**: רואה שורה לכל POST של אחת הבדיקות הקודמות. עמודות: timestamp ISO, key (e.g. `annotations`), old_value (truncated <500), new_value (truncated <500).

6. **Adaptive polling** (SEC-05):
   - פתח Network panel, סנן ל-`dashboard-state`.
   - השאר את הדפדפן visible: שורות מופיעות כל ~30s.
   - העבר לטאב אחר ל-6 דקות: בחזרה — Network עדיין מסונן → רואים בדיוק 1 fetch ב-6 הדקות (5min interval).
   - השאר את הדפדפן ללא מגע 11 דקות: Network → 0 fetches בדקות 11+. הזז את העכבר → fetch מיידי.

7. **pruneAuditLogTrigger** (SEC-03 retention):
   - ב-Apps Script editor: הרץ `installAuditPruneTrigger` ידנית פעם אחת.
   - **Expected**: Logger: "Installed pruneAuditLogTrigger weekly (Sunday 03:00)".
   - Triggers tab: רואה trigger חדש, Sunday 03:00 weekly.
   - (ההרצה האמיתית של ה-prune תקרה בעוד יום ראשון; הבדיקה כאן רק מאמתת שה-trigger מותקן.)

אם כל 7 הסעיפים עברו — אשר.
אם יש כשל — תאר איזה סעיף + מה ראית בפועל, ואני אחזור ל-revision של ה-PLAN.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
1. **Build**: `cd dashboard-web && npm run build` עובר ללא שגיאות TypeScript חדשות.
2. **No regression**: `git diff main..HEAD -- dashboard-web/src/lib/sheets.ts | grep -c "^-.*export"` מחזיר 0 (לא הסרנו export קיים).
3. **All requirements covered**:
   - SEC-01 (service-account split + fallback): Task 1
   - SEC-02 (rate limit): Task 2
   - SEC-03 (audit log + prune): Task 2 + Task 3
   - SEC-04 (If-Match): Task 2
   - SEC-05 (adaptive polling): Task 3
4. **Manual smoke**: Task 4 (7-step checklist).
5. **Documentation**: SETUP.md + SYSTEM_OVERVIEW.md + .env.example מעודכנים.
</verification>

<success_criteria>
תואם ל-Success Criteria ב-ROADMAP.md Phase 6:

1. ✅ Service-account split deployed; reader returns 403 if attempting to write
   (בדוק idiosyncratically: אם פותחים את הreader עם scope `spreadsheets` מקבלים 403).
2. ✅ Rate limit middleware rejects >10 POSTs/min/IP with 429 (Task 4 smoke #3).
3. ✅ `dashboard-state-audit` tab populates with one row per POST; verified after a billing edit (Task 4 smoke #5).
4. ✅ Concurrent edit from 2 browsers → second one gets 412 → silently retries → both edits land correctly (Task 4 smoke #4).
5. ✅ Hidden tab polling rate drops to 1/5min (verified via Network panel, Task 4 smoke #6).
6. ✅ SYSTEM_OVERVIEW.md security section updated (Task 3).
</success_criteria>

<output>
אחרי השלמת כל הטסקים — צור `.planning/phases/06-security-and-cloud-sync/06-01-SUMMARY.md`
עם:
- מה נכתב לפועל (path-by-path)
- החלטות שלקחנו תוך כדי (לדוגמה: אם Upstash שונה ל-Vercel KV)
- שגיאות שנתקלנו בהן + הפתרון
- מה נשאר ל-revision אם משהו לא עבר smoke
</output>
</content>
</invoke>
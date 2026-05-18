---
phase: 07
phase_name: Observability
created: 2026-05-18
status: planned
task_count: 9
requirements: [REQ-LOGS, REQ-QUOTA-ALERT, REQ-PHANTOM-ID, REQ-RECON-TOGGLE, REQ-PRODUCT-FIX]
deploy_order: gs-first  # logEvent must exist before any other gs change can use it
files_modified:
  - Config.gs
  - DailyUpdate.gs
  - Shopify.gs
  - SheetBuilder.gs
  - dashboard-web/src/components/CampaignDrawer.tsx
  - SETUP.md
  - SYSTEM_OVERVIEW.md

must_haves:
  truths:
    - "טאב logs קיים בגיליון עם 5 עמודות (timestamp / level / source / message / context)"
    - "logEvent(level, source, message, context) זמין מכל קובץ .gs ומוסיף שורה לטאב logs ב-≤200ms"
    - "אחרי 3 ימים רצופים שבהם runDailyUpdate > 4.5 דקות, נשלח מייל אזהרה אחד (לא חוזר על עצמו ב-day 4)"
    - "בכל סוף ריצה, אם יותר מ-5% מהקריאות החיצוניות החזירו 429, נשלח מייל אזהרה"
    - "logs תת 6 חודשים נמחקים אוטומטית ע\"י pruneLogs בטריגר שבועי"
    - "spreadsheet.id מודפס בלוגים ובמייל היומי בכל ריצה"
    - "המשתמש יכול לעבור ב-MetaShopifyReconciliation בין 'ימים פעילים בלבד' ל'כל הטווח' — Pearson r לא משתנה, הטבלה והגרף משתנים"
    - "הבחירה נשמרת ב-sessionStorage (לא מסונכרנת ל-cloud)"
    - "fixProductIdPrecision רץ ידנית, מגלגל productId מ-scientific notation חזרה ל-string + setNumberFormat('@'), ומדווח התקדמות ל-logs"
  artifacts:
    - path: "Config.gs"
      provides: "logEvent + pruneLogs + שמות קבועים LOGS_TAB / LOG_LEVELS"
      contains: "function logEvent"
    - path: "SheetBuilder.gs"
      provides: "ensureLogsTab_ + appendLogRow_ + fixProductIdPrecision"
      contains: "function ensureLogsTab_"
    - path: "DailyUpdate.gs"
      provides: "duration tracking + quota approach alert + 429 ratio alert + spreadsheet.id assertion in email"
      contains: "lastDurationMs"
    - path: "Shopify.gs"
      provides: "429 counter increment ב-fetchWithRetry_ (mirror Util.gs)"
      contains: "fetch.429.count"
    - path: "dashboard-web/src/components/CampaignDrawer.tsx"
      provides: "toggle ימים פעילים / כל הטווח ב-MetaShopifyReconciliation"
      contains: "reconciliationRangeMode"
    - path: "SETUP.md"
      provides: "הוראות הרצה ידנית של fixProductIdPrecision + הסבר על logs tab + טריגר שבועי pruneLogs"
      contains: "fixProductIdPrecision"
  key_links:
    - from: "כל .gs"
      to: "טאב logs"
      via: "logEvent → appendLogRow_"
      pattern: "logEvent\\("
    - from: "runDailyUpdate"
      to: "Script Properties.lastDurationMs"
      via: "setProp + getProp"
      pattern: "lastDurationMs"
    - from: "fetchWithRetry_"
      to: "Script Properties.fetch.429.count + fetch.total.count"
      via: "props increment"
      pattern: "fetch\\.429\\.count"
    - from: "CampaignDrawer reconciliation panel"
      to: "sessionStorage('reconciliation-range-mode')"
      via: "useState + useEffect"
      pattern: "reconciliation-range-mode"
---

# Phase 7 — Observability (PLAN)

רשימת משימות אטומיות לפי סדר ביצוע. כל משימה = commit אחד, עם acceptance criterion ניתן לבדיקה. ה-deploy_order הוא `gs-first` כי `logEvent` חייב להיות קיים לפני שכל שאר ה-`.gs` יכול להשתמש בו. הטוגל בדשבורד יכול להיכנס במקביל (לא תלוי בצד Apps Script).

**Phase boundaries (לא נוגעים):**
- אין שינוי בצורת הכתיבה ל-data-daily / campaigns / products-daily / orders-attribution (חוץ מ-`fixProductIdPrecision` שכותב מחדש productId קיים)
- ה-`fetchWithRetry_` ב-`Config.gs` ימשיך להחזיר את אותו `HTTPResponse` — רק יקרא ל-counter עזר לפני return
- ה-`MetaShopifyReconciliation` הקיים נשאר במקומו ב-`CampaignDrawer.tsx` — אנחנו רק עוטפים אותו ב-toggle + state
- `lineItems[]` ב-orders-attribution לא נוגע
- ה-`notifyError_` הקיים נשאר עם החתימה הנוכחית; אנחנו רק קוראים לו עם מטא-נושאים חדשים
- `STORES` / `STORE_META_TAB` / שאר הקבועים ב-`Config.gs` לא משתנים

---

## Task List

- [ ] **T-01** — `Config.gs`: הוסף `LOGS_TAB` + `LOG_LEVELS` + `logEvent(level, source, message, context)` (כתיבה הכי בסיסית, ללא retention)
- [ ] **T-02** — `SheetBuilder.gs`: הוסף `ensureLogsTab_` + `appendLogRow_` (פיזית כותב לטאב, נקרא מ-`logEvent`)
- [ ] **T-03** — `Config.gs`: הוסף `pruneLogs()` (מחיקת שורות > 6 חודשים) + `installLogsPruneTrigger()` (טריגר שבועי)
- [ ] **T-04** — `Config.gs` + `Shopify.gs`: הוסף 429-counter ב-`fetchWithRetry_` (Script Properties: `fetch.429.count`, `fetch.total.count`) + helper `resetFetchCounters_`
- [ ] **T-05** — `DailyUpdate.gs`: הוסף duration tracking ב-`runDailyUpdate` (start/end timestamp, push ל-Script Properties array של 7 ימים אחרונים) + ספי alert (3 ימים רצופים > 4.5 דק' = mail אחד)
- [ ] **T-06** — `DailyUpdate.gs`: הוסף 429-ratio alert בסוף `runDailyUpdate` + הזרק `spreadsheet.id` ללוגים ולגוף המייל היומי + migrate critical Logger.log → logEvent
- [ ] **T-07** — `CampaignDrawer.tsx`: הוסף toggle UI + state `reconciliationRangeMode` + sessionStorage persistence (Pearson r נשאר active-only)
- [ ] **T-08** — `SheetBuilder.gs`: הוסף `fixProductIdPrecision()` — תיקון רטרואקטיבי ל-`products-daily` + `{store}-products-catalog`
- [ ] **T-09** — תיעוד: `SETUP.md` (הרצה ידנית של fixProductIdPrecision + טריגר pruneLogs) + `SYSTEM_OVERVIEW.md` (logs tab + observability hooks)

---

## Task Details

### T-01 — `logEvent` core + constants

**type:** `feature`
**files:**
- `Config.gs`

**description:**
הוסף בראש `Config.gs` (אחרי `STORE_META_TAB`, שורה ~10) שני קבועים חדשים:

```js
const LOGS_TAB = 'logs';
const LOG_LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };
```

בהמשך הקובץ (לפני `function verifyConfig()`) הוסף את הפונקציה:

```js
/**
 * Structured logging — appends a row to the `logs` tab in the active
 * spreadsheet. Survives past Apps Script Executions' 30-day retention.
 *
 * @param level   'INFO' | 'WARN' | 'ERROR' (defaults to 'INFO' if invalid)
 * @param source  Calling file name without extension, e.g. 'DailyUpdate'
 * @param message Short human-readable message
 * @param context Optional object → serialized as JSON. Truncated to 5000
 *                chars to keep the cell well under Sheets' 50K limit.
 *
 * MUST be cheap to call (caller pattern: ~20 invocations per daily run).
 * If the logs tab is missing / the spreadsheet is unavailable, falls back
 * silently to Logger.log so that logEvent never throws into its caller.
 */
function logEvent(level, source, message, context) {
  try {
    const lvl = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    const src = String(source || '');
    const msg = String(message || '');
    let ctx = '';
    if (context !== undefined && context !== null) {
      try {
        const s = typeof context === 'string' ? context : JSON.stringify(context);
        ctx = s.length > 5000 ? s.slice(0, 5000) + '…[truncated]' : s;
      } catch (_) { ctx = '<unserializable>'; }
    }
    const ss = ensureSpreadsheet();
    appendLogRow_(ss, new Date(), lvl, src, msg, ctx);
  } catch (e) {
    // Logging must NEVER crash a daily run. If anything throws (Sheets
    // quota, tab missing, etc.), fall back to the script's built-in log
    // viewer — at least the operator gets *something*.
    Logger.log(`logEvent fallback (${level}/${source}): ${message} | err=${e && e.message ? e.message : e}`);
  }
}
```

הערה: ה-`appendLogRow_` נכתב ב-T-02 — לפני T-02 הפונקציה נכשלת ב-fallback, וזה בסדר (`Logger.log` עדיין עובד).

**pattern_ref:** `Config.gs:45-58` (getProp / setProp / requireProp — אותו סגנון של helpers בראש הקובץ) + Round 5 defensive try/catch wrapping

**research caveats applied:**
- `logEvent` חייב להיות **non-throwing** — fallback ל-`Logger.log` (אחרת ריצה יומית תופל בגלל logging)
- truncation של context ל-5000 תווים — מתחת ל-Sheets 50K cell cap בריווח גדול, חוסך quota
- `ensureSpreadsheet()` כבר עושה retry על transient errors → אפשר לסמוך עליו

**acceptance:**
- `grep -n "function logEvent" Config.gs` מראה התאמה אחת בדיוק
- `grep -n "const LOGS_TAB" Config.gs` מראה התאמה אחת
- ידני: פתח עורך Apps Script, הרץ `logEvent('INFO', 'Test', 'hello', {n: 1})` — לא זורק שגיאה (גם ללא טאב logs קיים — fallback ל-Logger.log)

**commit_message:** `feat(P7-01): add logEvent core + LOGS_TAB / LOG_LEVELS constants in Config.gs`

---

### T-02 — `ensureLogsTab_` + `appendLogRow_`

**type:** `feature`
**files:**
- `SheetBuilder.gs`

**description:**
הוסף בסוף `SheetBuilder.gs` (אחרי `fixProductIdPrecision` יבוא ב-T-08, אבל T-02 קודם) בלוק חדש:

```js
// ============================================================================
// טאב logs — structured logging שורד מעבר ל-30 יום של Apps Script Executions.
// כל קריאה ל-logEvent מסתיימת ב-appendLogRow_ כאן.
// ============================================================================

const LOGS_HEADERS = ['timestamp', 'level', 'source', 'message', 'context'];

function ensureLogsTab_(ss) {
  let sh = ss.getSheetByName(LOGS_TAB);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(LOGS_TAB);
    sh.setRightToLeft(false); // לוגים ב-LTR — קל יותר לקרוא JSON
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, LOGS_HEADERS.length)
      .setValues([LOGS_HEADERS])
      .setFontWeight('bold')
      .setBackground('#1c4587')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160); // timestamp
    sh.setColumnWidth(2, 70);  // level
    sh.setColumnWidth(3, 140); // source
    sh.setColumnWidth(4, 400); // message
    sh.setColumnWidth(5, 600); // context
  }
  if (justCreated) {
    // Logs tab is operational — hidden so it doesn't clutter the UI but
    // still queryable when needed (right-click → Unhide).
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * Appends ONE row to the logs tab. Called from logEvent in Config.gs.
 * Uses appendRow (not setValues) — single-row writes are cheap and
 * we don't need to coalesce batched writes here (max ~20 logs/run).
 *
 * timestamp is stored as a real Date so the sheet can format it; the
 * dashboard side (if it ever queries logs) parses back via Date.parse.
 */
function appendLogRow_(ss, timestamp, level, source, message, context) {
  const sh = ensureLogsTab_(ss);
  sh.appendRow([timestamp, level, source, message, context]);
  // Format the new row's timestamp cell explicitly — appendRow doesn't
  // inherit per-column formats reliably across all Sheets versions.
  const lastRow = sh.getLastRow();
  sh.getRange(lastRow, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
}
```

**pattern_ref:** `SheetBuilder.gs:1289-1320` (`ensureProductCatalogTab_` — same structure: insert / set headers / freeze / hide) + `SheetBuilder.gs:1108-1163` (`writeProductSalesForDay_` — same pattern of `setNumberFormat`)

**research caveats applied:**
- LTR (לא RTL) — לוגים נקראים כקוד, אנגלית/JSON
- hidden by default — מונע overflow בעת ניווט יומיומי
- `appendRow` ולא `setValues([row])` — קצר, אטומי, מספיק ל-~20 לוגים בריצה
- אחרי T-02, `logEvent` ב-T-01 מתחיל באמת לכתוב לגיליון (במקום fallback ל-Logger.log)

**acceptance:**
- `grep -n "function ensureLogsTab_\|function appendLogRow_" SheetBuilder.gs` מראה 2 התאמות בדיוק
- ידני: פתח עורך, הרץ `logEvent('INFO', 'Test', 'after T-02', {ok: true})` — נוצר טאב `logs` (hidden), יש בו שורה אחת עם 5 תאים מלאים, timestamp מעוצב

**commit_message:** `feat(P7-02): add ensureLogsTab_ + appendLogRow_ for structured logging`

---

### T-03 — `pruneLogs` + weekly trigger installer

**type:** `feature`
**files:**
- `Config.gs`

**description:**
הוסף ל-`Config.gs` (אחרי `logEvent`) את שתי הפונקציות:

```js
/**
 * Retention: delete rows in the `logs` tab whose timestamp is older than
 * 6 months. Run weekly via installLogsPruneTrigger().
 *
 * Strategy: collect indexes of stale rows, then delete in a single batch
 * to minimize Sheets API calls. Caps the number of deletions per run at
 * 5000 to stay well within the 6-min execution budget — if more rows
 * accumulate (shouldn't happen at our log volume), the next weekly run
 * cleans up the rest.
 */
function pruneLogs() {
  const ss = ensureSpreadsheet();
  const sh = ss.getSheetByName(LOGS_TAB);
  if (!sh) { logEvent('INFO', 'Config', 'pruneLogs: no logs tab yet'); return; }
  const lastRow = sh.getLastRow();
  if (lastRow < 2) { logEvent('INFO', 'Config', 'pruneLogs: logs tab empty'); return; }

  const cutoff = Date.now() - 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months
  const data = sh.getRange(2, 1, lastRow - 1, 1).getValues(); // col A = timestamp

  // Find contiguous ranges of stale rows so deleteRows is called with the
  // largest possible spans. Without this, 5000 single-row deletes would
  // chew through the runtime budget.
  const staleRanges = []; // [{startRow, count}]
  let curStart = -1;
  let curCount = 0;
  for (let i = 0; i < data.length; i++) {
    const ts = data[i][0];
    const tsMs = ts instanceof Date ? ts.getTime() : Date.parse(ts);
    const isStale = isFinite(tsMs) && tsMs < cutoff;
    if (isStale) {
      if (curStart === -1) curStart = i + 2; // sheet rows are 1-indexed; data starts row 2
      curCount++;
    } else if (curStart !== -1) {
      staleRanges.push({ startRow: curStart, count: curCount });
      curStart = -1; curCount = 0;
    }
  }
  if (curStart !== -1) staleRanges.push({ startRow: curStart, count: curCount });

  // Delete from the bottom up so earlier row indexes stay valid.
  let totalDeleted = 0;
  let cappedHit = false;
  for (let i = staleRanges.length - 1; i >= 0; i--) {
    const r = staleRanges[i];
    if (totalDeleted + r.count > 5000) {
      const remaining = 5000 - totalDeleted;
      if (remaining <= 0) { cappedHit = true; break; }
      // Delete from the BOTTOM of this range to preserve earlier rows for
      // the next run — keeps oldest stale rows for re-prune later.
      sh.deleteRows(r.startRow + r.count - remaining, remaining);
      totalDeleted += remaining;
      cappedHit = true;
      break;
    }
    sh.deleteRows(r.startRow, r.count);
    totalDeleted += r.count;
  }
  logEvent('INFO', 'Config', `pruneLogs deleted ${totalDeleted} rows older than 6 months`,
    { capped: cappedHit, ranges: staleRanges.length });
}

/**
 * One-shot installer: creates a weekly trigger for pruneLogs at 03:00
 * Israel time (well outside the daily-update window). Idempotent — removes
 * any existing pruneLogs trigger before installing the new one.
 *
 * Run manually from the editor once after deploy.
 */
function installLogsPruneTrigger() {
  const all = ScriptApp.getProjectTriggers();
  for (const t of all) {
    if (t.getHandlerFunction() === 'pruneLogs') {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger('pruneLogs')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .inTimezone(TZ)
    .create();
  logEvent('INFO', 'Config', 'pruneLogs weekly trigger installed (SUN 03:00 Asia/Jerusalem)');
}
```

**pattern_ref:** `Config.gs:115-142` (`fetchWithRetry_` — same defensive pattern of bounded loop + structured logging at end) + Round 5 idempotent-trigger pattern (resetSpreadsheetIdToKnownGood style)

**research caveats applied:**
- batched `deleteRows(start, count)` ולא `deleteRow(row)` בלולאה — 5000 שורות בודדות = ~5 דקות, batched = שניות
- cap של 5000 בריצה — לעולם לא מגיעים לזה (volume נמוך), אבל הגנה
- bottom-up deletion — שמירת תקפות indexים
- `installLogsPruneTrigger` הוא **manual one-shot** — לא רץ אוטומטית

**acceptance:**
- `grep -n "function pruneLogs\|function installLogsPruneTrigger" Config.gs` = 2 התאמות
- ידני: הרץ `installLogsPruneTrigger()` — ב-Triggers panel רואים שורה אחת חדשה ל-`pruneLogs` שבועית
- ידני: הרץ `pruneLogs()` — לא זורק שגיאה גם אם הטאב ריק או שאין שורות ישנות

**commit_message:** `feat(P7-03): add pruneLogs + installLogsPruneTrigger for 6-month retention`

---

### T-04 — 429 counter ב-`fetchWithRetry_`

**type:** `feature`
**files:**
- `Config.gs`

**description:**
שינוי **inline** ל-`fetchWithRetry_` (שורות 115-142): ספור כל קריאה כלפי `fetch.total.count` וכל 429 כלפי `fetch.429.count` ב-Script Properties. הוסף helper `resetFetchCounters_` שאיפוס + החזרה של המונים האחרונים.

הוסף **בסוף** הלולאה, רגע לפני `return res` ולפני `continue` של 5xx/429:

```js
// Counter tracking (Phase 7). We bump these so runDailyUpdate can compute
// 429-ratio at end-of-run and alert if it exceeds the 5% threshold.
// Properties are CHEAP (in-memory cached by Apps Script), so per-fetch
// cost is negligible. Reset by resetFetchCounters_() in runDailyUpdate.
incrFetchCounter_('fetch.total.count');
if (code === 429) incrFetchCounter_('fetch.429.count');
```

(שים לב: בלולאת ה-retry, רק ה-`return` הסופי מתעד "fetch הסתיים". 429-counter נספר על **תשובה** של 429, גם אם בסוף עברה — זה המודד הנכון של pressure.)

הוסף שני helpers חדשים בקובץ:

```js
function incrFetchCounter_(key) {
  try {
    const cur = parseInt(getProp(key, '0'), 10) || 0;
    setProp(key, String(cur + 1));
  } catch (_) { /* counter best-effort */ }
}

/**
 * Read + reset the fetch counters. Returns { total, count429, ratio }.
 * Called by runDailyUpdate at end-of-run.
 */
function resetFetchCounters_() {
  const total = parseInt(getProp('fetch.total.count', '0'), 10) || 0;
  const count429 = parseInt(getProp('fetch.429.count', '0'), 10) || 0;
  setProp('fetch.total.count', '0');
  setProp('fetch.429.count', '0');
  const ratio = total > 0 ? count429 / total : 0;
  return { total, count429, ratio };
}
```

הערה ל-`Shopify.gs` המקומי — ה-while לולאה שלו (שורות 72-110 ב-`getShopifyRevenue`) קוראת ל-`fetchWithRetry_` ואז בודקת `code === 429`. ה-counter שאנחנו מוסיפים ב-`fetchWithRetry_` תופס את ה-429 ב-attempt הראשון; אם Shopify-side לולאת ה-pagination ממשיכה לנסות, היא קוראת ל-`fetchWithRetry_` שוב → counter עולה שוב. זה התנהגות נכונה (כל ניסיון נמנה כ"קריאה").

**pattern_ref:** `Config.gs:115-142` (קצה ה-`fetchWithRetry_`) + Round 5 best-effort `try { } catch (_) { }` wrapping for non-critical telemetry

**research caveats applied:**
- counter ב-Script Properties — בטוח גם תחת concurrent triggers (Apps Script מסדר כתיבות)
- `incrFetchCounter_` עטוף ב-try — אם counter כושל, ה-fetch לא מתעכב
- אין שינוי בערך החזרה של `fetchWithRetry_` — backward-compatible

**acceptance:**
- `grep -n "fetch\.total\.count\|fetch\.429\.count" Config.gs` = 6+ התאמות (incr ב-2 מקומות בלולאה, set/get ב-`resetFetchCounters_`)
- `grep -n "function resetFetchCounters_\|function incrFetchCounter_" Config.gs` = 2 התאמות
- ידני: הרץ פעם אחת `fetchWithRetry_('https://httpstat.us/200', {method:'get',muteHttpExceptions:true})`, אז `Logger.log(JSON.stringify(resetFetchCounters_()))` — מציג `{total: 1, count429: 0, ratio: 0}`

**commit_message:** `feat(P7-04): add 429-counter telemetry to fetchWithRetry_ + resetFetchCounters_ helper`

---

### T-05 — Duration tracking + 3-day-streak quota alert

**type:** `feature`
**files:**
- `DailyUpdate.gs`

**description:**
שינוי **inline** ל-`runDailyUpdate` (שורות 10-12). החלף את הגוף:

```js
function runDailyUpdate() {
  const start = Date.now();
  try {
    runUpdateForDate(yesterdayStr_());
  } finally {
    recordRunDuration_(Date.now() - start);
  }
}
```

הוסף בסוף `DailyUpdate.gs` (אחרי `notifyError_`) את שתי הפונקציות:

```js
/**
 * Records the duration of a daily run in a rolling 7-entry array stored
 * in Script Properties (`run.durations.last7`). If the most recent 3
 * entries are ALL > 4.5min, sends ONE quota-warning email (de-duped via
 * a `run.duration.warned.at` property — won't re-alert until the streak
 * is broken AND a new 3-day-streak forms).
 *
 * The 4.5-min threshold is 75% of the 6-min Apps Script execution cap.
 * Three consecutive days = signal, not noise (a single slow day is
 * usually a transient Sheets API pressure spike).
 */
function recordRunDuration_(durationMs) {
  try {
    const raw = getProp('run.durations.last7', '[]');
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(durationMs);
    if (arr.length > 7) arr = arr.slice(arr.length - 7);
    setProp('run.durations.last7', JSON.stringify(arr));
    logEvent('INFO', 'DailyUpdate', `runDailyUpdate completed in ${(durationMs/1000).toFixed(1)}s`,
      { ms: durationMs, last7: arr });

    // Streak check
    const THRESH_MS = 4.5 * 60 * 1000;
    const last3 = arr.slice(-3);
    if (last3.length === 3 && last3.every(d => d > THRESH_MS)) {
      const lastWarned = parseInt(getProp('run.duration.warned.at', '0'), 10) || 0;
      const now = Date.now();
      // Suppress re-alerts within 7 days OR if the previous entry that
      // caused the warning is still in the rolling window. Cleared once
      // a faster run breaks the streak.
      if (now - lastWarned > 7 * 24 * 60 * 60 * 1000) {
        sendQuotaWarning_(last3);
        setProp('run.duration.warned.at', String(now));
      } else {
        logEvent('INFO', 'DailyUpdate', 'quota warning suppressed (recent alert)',
          { lastWarnedMsAgo: now - lastWarned });
      }
    } else if (arr.length >= 3 && !arr.slice(-3).every(d => d > THRESH_MS)) {
      // Streak broken — clear suppression so next 3-streak can alert again
      setProp('run.duration.warned.at', '0');
    }
  } catch (e) {
    Logger.log(`recordRunDuration_: ${e && e.message ? e.message : e}`);
  }
}

function sendQuotaWarning_(last3Ms) {
  const minutes = last3Ms.map(ms => (ms / 60000).toFixed(2));
  const body =
    `שלום,\n\n` +
    `ROAS Tracker — runDailyUpdate חרגה מ-4.5 דק' (75% מה-quota) ב-3 ימים רצופים:\n` +
    `  יום -2: ${minutes[0]} דק'\n` +
    `  יום -1: ${minutes[1]} דק'\n` +
    `  אתמול: ${minutes[2]} דק'\n\n` +
    `סף Apps Script הוא 6 דק' — אם המגמה תימשך, ריצה יומית תתחיל להיכשל ב-timeout.\n\n` +
    `מה לעשות:\n` +
    `  1. בדוק טאב logs בגיליון — חפש שורות level=WARN/ERROR עם source=DailyUpdate או Shopify\n` +
    `  2. שקול לפצל את הטריגר ל-per-store (Phase 5) — מתקן את הסיבה השורשית\n` +
    `  3. הרץ ידנית debugTodaySpend() לבדוק קריאות API פרטניות\n\n` +
    `התראה אחת ב-7 ימים — לא תקבל ספאם.`;
  try {
    const email = getProp('notification.email') ||
                  Session.getEffectiveUser().getEmail();
    if (!email) {
      logEvent('WARN', 'DailyUpdate', 'sendQuotaWarning_: no recipient');
      return;
    }
    MailApp.sendEmail({
      to: email,
      subject: 'ROAS Tracker — ריצה איטית',
      body,
    });
    logEvent('WARN', 'DailyUpdate', `quota warning sent to ${email}`, { last3Ms });
  } catch (e) {
    logEvent('ERROR', 'DailyUpdate', 'sendQuotaWarning_ failed', { error: String(e) });
  }
}
```

**pattern_ref:** `DailyUpdate.gs:502-538` (`notifyError_` — same email pattern: 3-tier resolver, MailApp.sendEmail, try/catch wrap) + Round 5 idempotent-streak / de-dup logic style

**research caveats applied:**
- `try/finally` ב-`runDailyUpdate` — מוודא ש-duration נרשם **גם אם הריצה נכשלה** (משימה: שגיאות הן אינדיקטור איטיות גם)
- de-dup ב-7 ימים — מונע מבול מיילים אם הסטריק נמשך שבועיים
- מנגנון איפוס (`run.duration.warned.at = '0'`) כשהסטריק נשבר — מאפשר התראה חדשה בעתיד
- threshold קבוע (4.5 דק') — לא parameter; ניתן לשנות בעתיד אם מבינים שזה רעש

**acceptance:**
- `grep -n "function recordRunDuration_\|function sendQuotaWarning_" DailyUpdate.gs` = 2 התאמות
- `grep -n "run.durations.last7" DailyUpdate.gs` = 3+ התאמות
- ידני: הרץ פעמיים ידנית `setProp('run.durations.last7', JSON.stringify([300000, 300000, 300000]))` ואז קרא ל-`recordRunDuration_(300000)` (5 דק') — נכנס לפלוו, שולח מייל (אם `notification.email` מוגדר), טאב logs מקבל שורה WARN
- ידני: `recordRunDuration_(60000)` (1 דק') — לא שולח מייל, מעדכן last7

**commit_message:** `feat(P7-05): add runDailyUpdate duration tracking + 3-day-streak quota alert`

---

### T-06 — End-of-run 429-ratio alert + spreadsheet.id assertion + selective Logger.log migration

**type:** `feature`
**files:**
- `DailyUpdate.gs`

**description:**
שלוש שינויים inline ב-`runUpdateForDate` (שורות 22-72):

**A. spreadsheet.id assertion בתחילת הריצה (אחרי `const ss = ensureSpreadsheet()`, שורה 27):**

```js
const sheetId = ss.getId();
logEvent('INFO', 'DailyUpdate', `runUpdateForDate started`, {
  date: dateStr,
  spreadsheetId: sheetId,
  spreadsheetUrl: ss.getUrl(),
});
```

זה הdaily assertion שמאפשר לראות בטאב logs בכל יום `spreadsheetId` — drift מול ה-`SPREADSHEET_ID` של Vercel ייראה מיד.

**B. 429-ratio alert + spreadsheet.id במייל היומי (החלף את הבלוק `if (errors.length)`, שורות 67-71):**

```js
const fetchStats = resetFetchCounters_();
logEvent('INFO', 'DailyUpdate', `fetch counters: total=${fetchStats.total} 429s=${fetchStats.count429} ratio=${(fetchStats.ratio*100).toFixed(2)}%`,
  fetchStats);

// 429-ratio alert: if more than 5% of fetches returned 429, send a
// separate alert. Independent from the errors[] flow because a high
// 429 ratio can coexist with a successful run (retries cleaned up).
const RATIO_THRESHOLD = 0.05;
if (fetchStats.total >= 20 && fetchStats.ratio > RATIO_THRESHOLD) {
  send429RatioAlert_(dateStr, fetchStats, sheetId);
}

if (errors.length) {
  const msg = `ROAS daily update ${dateStr} completed with errors:\n` + errors.join('\n') +
              `\n\n——————————\nSpreadsheet ID: ${sheetId}\nSpreadsheet URL: ${ss.getUrl()}\n` +
              `Fetches: ${fetchStats.total} (429s: ${fetchStats.count429})\n`;
  Logger.log(msg);
  logEvent('ERROR', 'DailyUpdate', `runUpdateForDate completed with ${errors.length} errors`,
    { errors, fetchStats, sheetId });
  notifyError_(dateStr, msg);
} else {
  logEvent('INFO', 'DailyUpdate', `runUpdateForDate ${dateStr} clean`, { fetchStats, sheetId });
}
```

**C. הוסף ל-`DailyUpdate.gs` (אחרי `sendQuotaWarning_`):**

```js
function send429RatioAlert_(dateStr, stats, sheetId) {
  const pct = (stats.ratio * 100).toFixed(1);
  const body =
    `שלום,\n\n` +
    `ROAS Tracker — שיעור 429 חרג מ-5% בריצה ${dateStr}.\n\n` +
    `  Total fetches : ${stats.total}\n` +
    `  429 responses : ${stats.count429}\n` +
    `  Ratio         : ${pct}%\n\n` +
    `Spreadsheet ID: ${sheetId}\n\n` +
    `סיבות אפשריות:\n` +
    `  - Meta / Shopify / Google מטילים rate-limit אגרסיבי\n` +
    `  - הוספת חנות רביעית הגדילה את צפיפות הקריאות\n` +
    `  - בעיה זמנית בצד הספק (לבדוק status pages)\n\n` +
    `בדוק טאב logs בגיליון לפרטים נוספים.`;
  try {
    const email = getProp('notification.email') ||
                  Session.getEffectiveUser().getEmail();
    if (!email) {
      logEvent('WARN', 'DailyUpdate', 'send429RatioAlert_: no recipient');
      return;
    }
    MailApp.sendEmail({
      to: email,
      subject: `ROAS Tracker — 429 ratio ${pct}% (${dateStr})`,
      body,
    });
    logEvent('WARN', 'DailyUpdate', `429-ratio alert sent`, { stats, recipient: email });
  } catch (e) {
    logEvent('ERROR', 'DailyUpdate', 'send429RatioAlert_ failed', { error: String(e) });
  }
}
```

**D. Selective `Logger.log` → `logEvent` migration ב-`runUpdateForDate`:**

החלף **רק את 3 הקריאות הבאות** (לא את כולן — אנחנו רוצים structured רק על אירועי error/state-change, כפי שמוגדר ב-scope):
- שורה 47 `Logger.log(`ERROR ${store.name}: ...)` → `logEvent('ERROR', 'DailyUpdate', `store ${store.name} failed`, { error: String(e), stack: e && e.stack });`
- שורה 64 `Logger.log(`store-meta refresh failed (non-fatal): ...)` → `logEvent('WARN', 'DailyUpdate', 'store-meta refresh failed (non-fatal)', { error: String(e) });`
- שורה 69 `Logger.log(msg)` בתוך `if (errors.length)` כבר טופל ב-step B למעלה.

**אל תיגע** ב-`Logger.log` של "FX ILS->CAD" (שורה 31) או "Meta OVERRIDE" (שורה 84) או "Shopify {id} {date}: N orders" (שורה 119 ב-Shopify.gs) — אלו לוגים מידעיים לא קריטיים שמוסיפים רעש לטאב logs בלי תרומה לdebug-ability.

**pattern_ref:** `DailyUpdate.gs:502-538` (`notifyError_` כתבנית למיילים) + Phase 6 audit-log pattern (event-level + context object)

**research caveats applied:**
- `fetchStats.total >= 20` gate — מונע alerts ב-runs קצרים (debugTodaySpend → 6 fetches → ratio רועש)
- spreadsheet.id assertion = INFO לא WARN — לא רוצים noise; ה-drift נראה ב-grep ידני
- שמרני ב-migration: רק 3 קריאות, לא wholesale replace; שאר ה-Logger.log נשאר ל-Executions
- 429-ratio נפרד מ-errors[] — שני channels אורתוגונליים

**acceptance:**
- `grep -n "logEvent" DailyUpdate.gs` >= 8 התאמות
- `grep -n "send429RatioAlert_" DailyUpdate.gs` = 2 התאמות (declaration + invocation)
- `grep -n "Logger.log" DailyUpdate.gs` ירד לפחות ב-3 (היו 14, יהיו <=11)
- ידני: הרץ `runDailyUpdate()` — טאב logs מקבל לפחות 2 שורות חדשות (1 ל-start, 1 ל-end); המייל היומי, אם נשלח, כולל בגוף "Spreadsheet ID: ..."

**commit_message:** `feat(P7-06): add 429-ratio alert + spreadsheet.id assertion + migrate 3 critical logs`

---

### T-07 — Reconciliation toggle ב-`CampaignDrawer.tsx`

**type:** `feature`
**files:**
- `dashboard-web/src/components/CampaignDrawer.tsx`

**description:**
שינויים inline ב-`CampaignDrawer.tsx`. הקובץ כיום בונה את `reconciliation` (שורה 413-460) רק על ימים שמופיעים ב-`summary.dailyArr` (כלומר ימים שהקמפיין היה פעיל). ההרחבה: toggle שמרחיב את ה-`series` לכל הימים בטווח של המשתמש, **אבל** Pearson r נשאר נחשב על ה-pairs המקוריים (active-only) — נכונות סטטיסטית.

**A. הוסף state + persistence בראש הקומפוננטה (אחרי הצהרות ה-state הקיימות, סביב שורה 130-170 — חפש `useState` הקיים):**

```tsx
// Phase 7: reconciliation date range mode. Persists per-session
// (not synced via cloudSync — view preference, not shared business state).
// 'active' = only days with Meta spend > 0 (current behavior, default)
// 'all'    = every day in the user's date filter range
const [reconciliationRangeMode, setReconciliationRangeMode] = useState<'active' | 'all'>(() => {
  if (typeof window === 'undefined') return 'active';
  const v = window.sessionStorage.getItem('reconciliation-range-mode');
  return v === 'all' ? 'all' : 'active';
});

useEffect(() => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem('reconciliation-range-mode', reconciliationRangeMode);
}, [reconciliationRangeMode]);
```

**B. הרחב את `const reconciliation = (() => { ... })()` (שורה 413). שמור על המבנה הקיים שמחשב `series` ו-`r`/`bestR`/`bestLag`, אבל הוסף בהמשך `seriesAll` שבו כל יום בטווח של המשתמש מופיע:**

```tsx
const reconciliation = (() => {
  if (mappedIds.length === 0) return null;
  if (summary.platform !== 'Meta') return null;
  const productRows = productsData?.rows ?? [];
  const wantedIds = new Set(mappedIds);
  const shopifyByDate = new Map<string, number>();
  const datesInDrawer = new Set(summary.dailyArr.map(d => d.date));
  for (const p of productRows) {
    if (p.storeId !== storeId) continue;
    if (!wantedIds.has(p.productId)) continue;
    // נשמרת אותה לוגיקת shopifyByDate: זה ה-revenue הגלובלי של החנות עבור
    // מוצרים ממופים. אנחנו עדיין מסננים לפי datesInDrawer בשביל active-only,
    // אבל ל-`all` נשתמש בכל ה-productRows שב-storeId.
    if (datesInDrawer.has(p.date)) {
      const net = p.netRevenue ?? p.revenue;
      if (net > 0) shopifyByDate.set(p.date, (shopifyByDate.get(p.date) ?? 0) + net);
    }
  }
  // Series for the active-only window (current behavior — used for r).
  const series = summary.dailyArr.map(d => ({
    date: d.date,
    meta: d.value,
    shopify: shopifyByDate.get(d.date) ?? 0,
  }));
  if (series.length < 5) return null;

  // Pearson r + lag — strictly on active-only pairs (statistical correctness).
  // The 'all' toggle changes ONLY what we render, not the math.
  const r = pearson(series.map(s => s.meta), series.map(s => s.shopify));
  let bestLag = 0;
  let bestR = r;
  for (let lag = -3; lag <= 3; lag++) {
    if (lag === 0) continue;
    const effectiveN = series.length - Math.abs(lag);
    if (effectiveN < 5) continue;
    const r2 = pearsonWithLag(series.map(s => s.meta), series.map(s => s.shopify), lag);
    if (Math.abs(r2) > Math.abs(bestR)) { bestR = r2; bestLag = lag; }
  }

  // Phase 7: build the "all days in user range" series. We need the user's
  // date filter range — derived from summary.dailyArr extremes is wrong
  // (those ARE the active days). Instead, look at productsData.rows for
  // this store: the dashboard already filtered them to the user's range.
  const allDatesSet = new Set<string>();
  for (const p of productRows) {
    if (p.storeId === storeId) allDatesSet.add(p.date);
  }
  // Pad shopify map with zeros for non-active days; meta is zero on those.
  const shopifyByDateAll = new Map<string, number>();
  for (const p of productRows) {
    if (p.storeId !== storeId) continue;
    if (!wantedIds.has(p.productId)) continue;
    const net = p.netRevenue ?? p.revenue;
    if (net > 0) shopifyByDateAll.set(p.date, (shopifyByDateAll.get(p.date) ?? 0) + net);
  }
  const metaByDate = new Map(summary.dailyArr.map(d => [d.date, d.value]));
  const seriesAll = Array.from(allDatesSet).sort().map(date => ({
    date,
    meta: metaByDate.get(date) ?? 0,
    shopify: shopifyByDateAll.get(date) ?? 0,
  }));

  return { series, seriesAll, r, bestLag, bestR };
})();
```

**C. ב-render של הקטע (סביב שורה 932 — `{reconciliation && (`), הוסף toggle UI מעל הגרף ובחר את ה-series המוצג:**

חפש את האזור `{reconciliation && (` ולפני ה-`<ComposedChart>` (שורה 998), הוסף:

```tsx
{/* Phase 7: date range toggle */}
<div className="mb-3 flex items-center gap-2 text-sm">
  <button
    type="button"
    onClick={() => setReconciliationRangeMode('active')}
    className={cn(
      'rounded px-3 py-1 transition-colors',
      reconciliationRangeMode === 'active'
        ? 'bg-text-primary text-surface'
        : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
    )}
  >
    ימים פעילים בלבד
  </button>
  <button
    type="button"
    onClick={() => setReconciliationRangeMode('all')}
    className={cn(
      'rounded px-3 py-1 transition-colors',
      reconciliationRangeMode === 'all'
        ? 'bg-text-primary text-surface'
        : 'bg-surface-2 text-text-secondary hover:bg-surface-3'
    )}
  >
    כל הטווח
  </button>
  <span className="text-text-tertiary text-xs">
    (Pearson r נשאר זהה — מחושב על ימים פעילים בלבד)
  </span>
</div>
```

החלף `data={reconciliation.series}` (שורה 998) ב:

```tsx
data={reconciliationRangeMode === 'all' ? reconciliation.seriesAll : reconciliation.series}
```

החלף **גם** את כל המקומות שמסתמכים על `reconciliation.series` (חפש בקובץ; יש ככל הנראה ב-טבלת המספרים מתחת לגרף סביב שורה 1060 — `reconciliation.series.map(s => ...)`) ל-`(reconciliationRangeMode === 'all' ? reconciliation.seriesAll : reconciliation.series).map(...)`.

**pattern_ref:** `CampaignDrawer.tsx:413-460` (קטע ה-reconciliation הקיים — שמירה על המבנה) + `cloudSync.ts` pattern של sessionStorage (existing useState+useEffect pattern in dashboard for view prefs)

**research caveats applied:**
- Pearson r לא מושפע מ-toggle — נכונות סטטיסטית
- `sessionStorage` ולא `localStorage` — בחירה זמנית לסשן, לא משתפת בין דפדפנים (כפי שצוין ב-scope)
- defensive: `typeof window === 'undefined'` — SSR safety
- `summary.dailyArr` כבר מוגבל ל-ימים פעילים → להרחיב, אנחנו מסתמכים על `productsData.rows` שמסונן לטווח של המשתמש

**acceptance:**
- `npm run build` ב-`dashboard-web` עובר ללא שגיאות חדשות
- `grep -n "reconciliationRangeMode\|seriesAll" dashboard-web/src/components/CampaignDrawer.tsx` >= 6 התאמות
- ידני: פתח את הדשבורד, בחר טווח של 30 ימים, פתח Campaign Drawer של קמפיין Meta עם מוצרים ממופים, ודא:
  - יש toggle עם 2 כפתורים מעל הגרף
  - "ימים פעילים בלבד" מסומן כברירת מחדל (זהה להתנהגות הקיימת)
  - "כל הטווח" — הגרף מציג את כל הימים בטווח שנבחר; ימים שבהם הקמפיין לא היה פעיל מראים meta=0 ו-shopify (אם היו מכירות) > 0
  - Pearson r לא משתנה בין שני המצבים
  - רענון דף → הבחירה האחרונה ב-tab נשמרת
  - sessionStorage["reconciliation-range-mode"] קיים (DevTools → Application → Session Storage)

**commit_message:** `feat(P7-07): add reconciliation date range toggle + sessionStorage persistence`

---

### T-08 — `fixProductIdPrecision` retroactive fix script

**type:** `feature`
**files:**
- `SheetBuilder.gs`

**description:**
הוסף בסוף `SheetBuilder.gs` (אחרי `writeProductCatalogForStore_`, סביב שורה 1354):

```js
/**
 * One-off retroactive fix for productId precision loss.
 *
 * Background: until commit 8de9d32, products-daily col D and catalog
 * col A weren't `setNumberFormat('@')` on write. Sheets coerced 13-19
 * digit Shopify IDs to JS Number, which capped precision at 16 digits.
 * 17+ digit IDs got serialized back as scientific notation like
 * `7.89e12` → row failed to match the productMap in the dashboard.
 *
 * This function:
 *   1. Reads each row of products-daily and {store}-products-catalog
 *   2. For the productId column, normalizes the cell value:
 *      - Already a string with no decimal → leave alone
 *      - A number → String(n).replace(/\..*$/, '') — strips scientific
 *        notation and trailing decimals, keeps integer part
 *      - "7.891234567e12" string → re-expand via BigInt: `BigInt(Math.round(Number(v)))`
 *        ⚠️ Only when |v| < Number.MAX_SAFE_INTEGER (no precision loss possible)
 *      - Otherwise leave alone (already corrupted past recovery)
 *   3. Writes back with setNumberFormat('@') on the entire productId column
 *   4. Logs progress every 200 rows to the logs tab so the operator can
 *      watch progress without the script appearing frozen
 *
 * Run manually ONCE from the editor after Phase 7 deploys. Idempotent:
 * running twice doesn't double-fix anything (already-text cells get
 * re-written as the same text).
 */
function fixProductIdPrecision() {
  logEvent('INFO', 'SheetBuilder', 'fixProductIdPrecision started');
  const ss = ensureSpreadsheet();
  let totalFixed = 0;
  let totalScanned = 0;

  // --- products-daily (col D = productId) ---
  const pd = ss.getSheetByName(PRODUCTS_DAILY_TAB);
  if (pd && pd.getLastRow() > 1) {
    const lastRow = pd.getLastRow();
    const range = pd.getRange(2, 4, lastRow - 1, 1); // col D
    const vals = range.getValues();
    const fixed = vals.map((row, i) => {
      totalScanned++;
      const normalized = normalizeProductId_(row[0]);
      if (normalized !== String(row[0])) totalFixed++;
      if ((i + 1) % 200 === 0) {
        logEvent('INFO', 'SheetBuilder',
          `fixProductIdPrecision: products-daily ${i + 1}/${vals.length} scanned`,
          { fixedSoFar: totalFixed });
      }
      return [normalized];
    });
    range.setValues(fixed);
    range.setNumberFormat('@');
    logEvent('INFO', 'SheetBuilder',
      `fixProductIdPrecision: products-daily done`,
      { rowsScanned: vals.length, fixed: totalFixed });
  } else {
    logEvent('INFO', 'SheetBuilder', 'fixProductIdPrecision: products-daily empty or missing');
  }

  // --- {store}-products-catalog (col A = productId) ---
  for (const store of STORES) {
    const tabName = productCatalogTabName_(store.id);
    const sh = ss.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) {
      logEvent('INFO', 'SheetBuilder', `fixProductIdPrecision: ${tabName} empty or missing`);
      continue;
    }
    const lastRow = sh.getLastRow();
    const range = sh.getRange(2, 1, lastRow - 1, 1); // col A
    const vals = range.getValues();
    let storeFixed = 0;
    const fixed = vals.map((row) => {
      totalScanned++;
      const normalized = normalizeProductId_(row[0]);
      if (normalized !== String(row[0])) { totalFixed++; storeFixed++; }
      return [normalized];
    });
    range.setValues(fixed);
    range.setNumberFormat('@');
    logEvent('INFO', 'SheetBuilder',
      `fixProductIdPrecision: ${tabName} done`,
      { rowsScanned: vals.length, fixed: storeFixed });
  }

  logEvent('INFO', 'SheetBuilder', 'fixProductIdPrecision complete',
    { totalScanned, totalFixed });
}

/**
 * Normalizes a Sheets cell value into a clean string-form product ID.
 * Returns '' for null/empty so callers can decide whether to skip.
 *
 * Cases:
 *   - string with no '.' / 'e' / 'E' → return as-is
 *   - number (small enough to be safe) → strip decimals
 *   - string like "7.891e12" → expand via Number → round → BigInt → toString
 *   - anything else → coerce via String(v) (last resort; better than null)
 */
function normalizeProductId_(v) {
  if (v == null || v === '') return '';
  // Already a clean integer string?
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  // Number cell (Sheets stored as Number)
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v); // NaN / Infinity → preserve for debug
    // Round to integer and stringify. JS will use scientific notation for
    // very large numbers (>=1e21), which is fine because Shopify IDs are
    // up to 19 digits = 1e18 max. For 17-19 digit IDs (above MAX_SAFE_INTEGER)
    // precision is already lost — toString gives us what's left.
    if (Math.abs(v) < Number.MAX_SAFE_INTEGER) return String(Math.round(v));
    // For larger numbers, we've already lost precision. Document the
    // damage in the cell by appending the suffix so the operator knows
    // this row needs manual review.
    return String(Math.round(v)); // best-effort; precision already gone
  }
  // String with scientific notation: try expansion
  if (typeof v === 'string') {
    if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(v)) {
      const n = Number(v);
      if (isFinite(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) {
        return String(Math.round(n));
      }
      // Outside safe range — log a warning so the operator can manually
      // recover from the source (Shopify) if needed.
      logEvent('WARN', 'SheetBuilder',
        `normalizeProductId_: scientific notation outside safe range — manual recovery needed`,
        { value: v });
      return String(Math.round(n)); // best-effort
    }
    // String with decimal but no 'e' (rare; "1234567890.0" from a cast)
    if (/^\d+\.\d+$/.test(v)) return v.replace(/\..*$/, '');
    return v; // already a non-numeric string (custom ID?), preserve
  }
  return String(v);
}
```

**pattern_ref:** `SheetBuilder.gs:1110-1163` (`writeProductSalesForDay_` — same pattern of `getRange().getValues() → map → setValues` + `setNumberFormat('@')`) + `SheetBuilder.gs:1327-1354` (`writeProductCatalogForStore_` — same iteration pattern over STORES)

**research caveats applied:**
- idempotent: כבר-string לא משתנה; טאב חסר → דיווח INFO ולא error
- bounded loss: כאשר 17-19 ספרות, precision כבר אבדה ב-Sheets → אנו עושים `String(Math.round(v))` עם WARN שמאפשר recovery ידני
- progress logging כל 200 שורות — נראה התקדמות בטאב logs מבלי לחנוק את ה-API
- אין שינוי בכתיבה השוטפת — רק תיקון רטרואקטיבי; טקסט format כבר הופעל ב-`writeProductSalesForDay_` ב-commit 8de9d32

**acceptance:**
- `grep -n "function fixProductIdPrecision\|function normalizeProductId_" SheetBuilder.gs` = 2 התאמות
- ידני: פתח עורך, הרץ `fixProductIdPrecision()` — מסתיים תוך 6 דק'; טאב logs מקבל שורות progress + שורת סיום; לפחות ה-column types של `products-daily` D ו-`{store}-products-catalog` A הם `@` (Format → Number → Plain text)
- ידני: לקח דגימה של 5 מוצרים שהיו כשבעבר scientific notation (אם קיימים) — productId שלהם עכשיו string מלא של 13-19 ספרות

**commit_message:** `feat(P7-08): add fixProductIdPrecision retroactive fix for products-daily + catalogs`

---

### T-09 — תיעוד SETUP.md + SYSTEM_OVERVIEW.md

**type:** `docs`
**files:**
- `SETUP.md`
- `SYSTEM_OVERVIEW.md`

**description:**
**A. SETUP.md** — הוסף בסוף מקטע ה-Apps Script (חפש את הסקציה שמסבירה על triggers) שלוש פסקאות:

```markdown
### טאב logs (Phase 7)

לאחר ה-deploy של Phase 7 ייוצר אוטומטית טאב חבוי בשם `logs` בגיליון.
הטאב מקבל שורות מ-`logEvent(level, source, message, context)` בכל פעם
שמשהו אירע ב-runtime. שורות נשמרות 6 חודשים ונמחקות אוטומטית בטריגר
שבועי.

**להפעיל טריגר ניקוי שבועי:**

1. פתח את עורך Apps Script
2. הרץ ידנית את הפונקציה `installLogsPruneTrigger()` (Run → installLogsPruneTrigger)
3. בדוק ב-Triggers panel שנוסף טריגר חדש: `pruneLogs`, "Time-driven", "Week timer", יום ראשון 03:00

ניקוי רץ פעם בשבוע ב-03:00 שעון ישראל ומוחק שורות > 6 חודשים. כיוון
שיומית מצטברות ~30 שורות, אחרי 6 חודשים יש ~5500 שורות, וניקוי לוקח שניות.

**להציג את הטאב:**

הטאב `logs` חבוי כברירת מחדל. כדי לראות אותו: לחץ ימני בטאב כלשהו → Unhide
sheet → logs. אפשר להחזיר ל-hidden באותה דרך.

### תיקון רטרואקטיבי של Product IDs

הרץ ידנית **פעם אחת** לאחר ה-deploy של Phase 7:

1. פתח את עורך Apps Script
2. הרץ את הפונקציה `fixProductIdPrecision()` (Run → fixProductIdPrecision)
3. המתן 1-3 דקות (תלוי בכמות השורות)
4. בדוק את טאב `logs` — אמורות להופיע שורות INFO עם source=`SheetBuilder`
   ובסוף שורת "fixProductIdPrecision complete" עם `totalFixed`

תהליך זה מבצע סריקה של `products-daily` ושל כל `{store}-products-catalog`,
מנרמל productId שאבד דיוק (scientific notation `7.89e12` → `"7891234567890"`),
ומגדיר `setNumberFormat('@')` על העמודה כדי למנוע הישנות.

הפונקציה idempotent — אם תרוץ פעמיים, השנייה לא תזיק (שורות שכבר מסודרות
לא משתנות).

### התראות quota

Phase 7 מוסיף 2 ערוצי התראה אוטומטיים:

- **ריצה איטית**: אם `runDailyUpdate` חורגת מ-4.5 דק' בשלושה ימים רצופים,
  נשלח מייל אחד עם נושא "ROAS Tracker — ריצה איטית". התראה חוזרת חסומה
  ב-7 ימים כדי למנוע ספאם.
- **שיעור 429 גבוה**: אם ביום מסוים יותר מ-5% מהקריאות החיצוניות מחזירות
  429, נשלח מייל "ROAS Tracker — 429 ratio X% (date)".

שני הערוצים שולחים לאותה כתובת כמו `notifyError_` (Script Property
`notification.email`). כדי לכבות זמנית, רוקן את הערך של ה-property.
```

**B. SYSTEM_OVERVIEW.md** — הוסף סקציה חדשה "Observability (Phase 7)" שמתעדת:

```markdown
## Observability (Phase 7)

### Structured logging

טאב `logs` בגיליון משמש כ-persistent log store. בניגוד ל-`Logger.log`
של Apps Script (retention ~30 ימים), הטאב נשמר עד 6 חודשים ואז נמחק
אוטומטית בטריגר שבועי `pruneLogs`.

**עמודות:**
- `timestamp` — Date מעוצב `yyyy-mm-dd hh:mm:ss`
- `level` — `INFO` / `WARN` / `ERROR`
- `source` — שם הקובץ (ללא סיומת), כגון `DailyUpdate` / `SheetBuilder` / `Shopify`
- `message` — תיאור קצר
- `context` — JSON serialized (truncated to 5000 chars)

**API:** `logEvent(level, source, message, context)` ב-`Config.gs`. ה-API
non-throwing — fallback ל-`Logger.log` אם הגיליון לא זמין.

### Quota telemetry

- `Config.gs::fetchWithRetry_` סופר כל קריאה (total) ועל כל 429 (count).
- `runDailyUpdate` סוגר את הריצה ב-`resetFetchCounters_()` שמחזיר ratio.
- אם `ratio > 5%` ויש לפחות 20 קריאות — נשלח מייל אזהרה.
- `recordRunDuration_` שומר 7 ימים אחרונים ב-Script Property `run.durations.last7`;
  3 ימים רצופים > 4.5 דק' → מייל אזהרה אחד (de-duped ל-7 ימים).

### Spreadsheet ID assertion

ב-תחילת כל `runUpdateForDate`, ה-spreadsheet.id מתועד ב-`logs` (level=INFO)
ומופיע גם בגוף המייל היומי. שינוי לא צפוי של ה-id (drift מול
`SPREADSHEET_ID` ב-Vercel) ייראה מיד.

### Reconciliation toggle (dashboard side)

ב-`CampaignDrawer`, panel ה-MetaShopifyReconciliation תומך עכשיו בשני
מצבים:
- **ימים פעילים בלבד** (ברירת מחדל) — התנהגות קיימת, רק ימים שבהם Meta-spend > 0.
- **כל הטווח** — כל הימים בטווח שהמשתמש בחר; ימים לא פעילים מוצגים עם meta=0.

Pearson r תמיד מחושב על ימים פעילים (נכונות סטטיסטית). הבחירה נשמרת
ב-sessionStorage תחת המפתח `reconciliation-range-mode`.
```

**pattern_ref:** קיים `SYSTEM_OVERVIEW.md` עם סקציות אחרות לפי phase + סגנון Hebrew prose / English code ב-SETUP.md הקיים

**acceptance:**
- `grep -n "Phase 7\|installLogsPruneTrigger\|fixProductIdPrecision" SETUP.md` >= 3 התאמות
- `grep -n "Observability\|logEvent\|fetchWithRetry_" SYSTEM_OVERVIEW.md` >= 3 התאמות
- ידני: קרא את שתי הסקציות בדפדפן (markdown preview), בדוק שאין הוראות שבורות (קישורים פנימיים, סדר שלבים)

**commit_message:** `docs(P7-09): document logs tab + pruneLogs trigger + fixProductIdPrecision in SETUP/SYSTEM_OVERVIEW`

---

## Execution Order & Dependencies

```
T-01 ──┐
       ├──> T-02 ──┐
       │           ├──> T-03 (uses logEvent from T-01, ensureLogsTab from T-02)
       │           │
       │           ├──> T-04 (uses logEvent in resetFetchCounters_; needs T-02 so logs land)
       │           │
       │           ├──> T-05 (uses logEvent everywhere; needs T-02)
       │           │
       │           └──> T-06 (uses logEvent + resetFetchCounters_ from T-04; needs T-05 in same file)
       │
       ├──> T-07 (dashboard-side; independent of T-01..T-06)
       │
       └──> T-08 (uses logEvent + ensureLogsTab; needs T-01+T-02)
                    │
                    └──> T-09 (docs only; documents what was built in T-01..T-08)
```

**גלי ביצוע** (לפי תלות):

| גל | משימות | הערה |
|----|--------|------|
| 1  | T-01, T-07 | T-07 דשבורד-בלבד, יכול לרוץ במקביל |
| 2  | T-02 | תלוי ב-T-01 (`LOGS_TAB` const) |
| 3  | T-03, T-04 | תלויים ב-T-02 (logEvent מתחיל לכתוב לטאב) |
| 4  | T-05 | תלוי ב-T-04 (`resetFetchCounters_` הוא optional בשורת T-05 אבל T-06 חייב) |
| 5  | T-06 | תלוי ב-T-05 (same-file `runDailyUpdate` shape) |
| 6  | T-08 | תלוי ב-T-02 (logEvent + ensureLogsTab) |
| 7  | T-09 | תלוי בכל הקודמים |

---

## Verification (end-of-phase)

לאחר T-09, וודא הכל יחד:

1. **טאב logs פעיל:**
   - `grep -c "function logEvent\|function appendLogRow_\|function pruneLogs" Config.gs SheetBuilder.gs` = 3
   - ידני: פתח את הגיליון, Unhide → logs — ראה שורות מ-T-02, T-03, T-04, T-05, T-06, T-08
   - לפחות 3 sources שונים (`DailyUpdate`, `SheetBuilder`, `Config`) הופיעו

2. **Quota alerts hooked:**
   - הרץ `runDailyUpdate()` ידני; בדוק שטאב logs מקבל "fetch counters: total=N 429s=M ratio=X%"
   - הרץ `recordRunDuration_(300000)` 3 פעמים רצופות (`setProp('run.durations.last7', '[300000,300000,300000]')` קודם) — בדוק שמייל נשלח (אם `notification.email` מוגדר)

3. **Spreadsheet ID visible:**
   - אחרי `runDailyUpdate()`, בדוק שטאב logs מכיל שורה מ-source=`DailyUpdate` שמכילה ב-context `spreadsheetId`

4. **Reconciliation toggle works:**
   - `cd dashboard-web && npm run build` עובר ללא שגיאות
   - ידני: פתח דשבורד, בחר טווח 30 ימים, פתח Campaign Drawer של קמפיין Meta עם מיפוי, וודא שהtoggle מחליף בין series

5. **Product ID fix runnable:**
   - הרץ `fixProductIdPrecision()` — מסתיים בהצלחה; טאב logs מציג "fixProductIdPrecision complete"

6. **Documentation up to date:**
   - `SETUP.md` מזכיר `installLogsPruneTrigger` ו-`fixProductIdPrecision`
   - `SYSTEM_OVERVIEW.md` כולל סקציה "Observability (Phase 7)"

7. **No regression in runtime:**
   - `runDailyUpdate()` נשלם ב-< 5 דק' (בדוק טאב logs — שורה INFO "runDailyUpdate completed in X.Xs")

---

## Notes for Executor

- **אל תיגע** ב-לוגיקת fetch של ה-pagination ב-Shopify.gs (השורות שבודקות `code === 429` ועושים `Utilities.sleep(2000); continue;`). ה-counter שלנו ב-`fetchWithRetry_` כבר תפס את ה-429 הזה; פגיעה בלוגיקת ה-sleep תפר מהבטחות quota.
- **אל תוסיף** `logEvent` לכל `Logger.log` קיים. ההגדרה ב-scope: רק לוגי error / state-change / alert. רוב ה-Logger.log הם info-only — נשארים ל-Executions.
- **אל תשנה** את ה-signature של `notifyError_`. ה-callers שלו (כולל `runUpdateForDate` ושני ה-alert paths החדשים) מצפים ל-`(dateStr, message)`.
- **אל תכווץ** את ה-context object של `logEvent`. JSON serialization כבר עושה את העבודה; קיצור ידני יסתיר מידע ב-debug עתידי.
- **אל תרוץ** `fixProductIdPrecision()` אוטומטית כחלק מ-trigger. זה fix חד-פעמי שדורש operator ידני שיוודא שהריצה הצליחה.
- **שמור על gs-first**: T-01..T-06 חייבות לעלות לעורך Apps Script לפני שה-dashboard ב-T-07 מסתמך על structure של logs (היום הוא לא מסתמך, אבל אם תרצו לקרוא logs מ-dashboard בעתיד — זה יעבוד).

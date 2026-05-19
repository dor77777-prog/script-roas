/**
 * Main.gs - נקודות כניסה: setup, triggers, menu.
 */

/**
 * הפעל פעם אחת ידנית מעורך Apps Script לאחר השלמת Script Properties.
 * יוצר את הגיליון (אם לא קיים), בונה טאבים, מתקין טריגר יומי.
 */
function setupAll() {
  const ss = ensureSpreadsheet();
  ensureManualSpendTab_(ss);   // טאב להזנה ידנית של הוצאות (override ל-API)
  installDailyTrigger();   // 00:05 IT - "closes" yesterday's data
  installLiveTrigger();    // every 15 min - refreshes today's data so the dashboard is live
  Logger.log('================================');
  Logger.log('Setup complete.');
  Logger.log('Spreadsheet URL: ' + ss.getUrl());
  Logger.log('Daily trigger: every day at 00:05 Asia/Jerusalem (סוגר את היום הקודם)');
  Logger.log('Live trigger: every 15 minutes (מרענן את היום הנוכחי בדשבורד)');
  Logger.log('Web Dashboard: deployed separately at Vercel (see dashboard-web/)');
  Logger.log('================================');
  return ss.getUrl();
}

/**
 * רק יוצר את הגיליון (בלי טריגר). מומלץ להריץ פעם ראשונה לבד כדי לבדוק שהכל תקין.
 */
function setupCreateSheet() {
  const ss = ensureSpreadsheet();
  Logger.log('Spreadsheet URL: ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * Installs FOUR daily triggers (Phase 5 trigger split):
 *   - runDailyUpdateUzoshop      @ 00:05 IL
 *   - runDailyUpdateZolplus      @ 00:08 IL
 *   - runDailyUpdateUsmile       @ 00:11 IL
 *   - refreshAllStoreMeta        @ 00:14 IL
 *
 * Each per-store function runs in its OWN Apps Script execution, so each
 * gets its OWN 6-min budget and its OWN Sheets API short-window quota
 * window. The 3-min spacing between them gives the quota a chance to
 * refresh between executions.
 *
 * Note: unlike the old installer, this one does NOT run any of the
 * functions immediately. The first per-store run happens at the next
 * scheduled minute (e.g., next 00:05). Rationale: an immediate
 * sequential run of all 3 stores from inside installDailyTrigger would
 * defeat the very quota separation we're trying to set up. If you want
 * to backfill yesterday right now, run `runDailyUpdate` (the manual
 * entry point that retains the original sequential behavior) from the
 * editor.
 */
function installDailyTrigger() {
  removeDailyTrigger();

  ScriptApp.newTrigger('runDailyUpdateUzoshop')
    .timeBased().atHour(0).nearMinute(5).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('runDailyUpdateZolplus')
    .timeBased().atHour(0).nearMinute(8).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('runDailyUpdateUsmile')
    .timeBased().atHour(0).nearMinute(11).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('refreshAllStoreMeta')
    .timeBased().atHour(0).nearMinute(14).everyDays(1).inTimezone(TZ).create();

  Logger.log('4 daily triggers installed: uzoshop@00:05, zolplus@00:08, usmile@00:11, store-meta@00:14 (Asia/Jerusalem)');
  Logger.log('First run at next 00:05 IL. To backfill yesterday immediately, run runDailyUpdate from the editor.');
}

/**
 * Removes ALL handlers that the daily-trigger installer knows about,
 * including the legacy single-trigger handler ('runDailyUpdate') so a
 * re-install after deploying Phase 5 doesn't leave the old trigger
 * orphaned. installLiveTrigger remains untouched.
 */
function removeDailyTrigger() {
  const HANDLERS = new Set([
    'runDailyUpdate',          // legacy — pre-Phase-5
    'runDailyUpdateUzoshop',
    'runDailyUpdateZolplus',
    'runDailyUpdateUsmile',
    'refreshAllStoreMeta',
  ]);
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const t of triggers) {
    if (HANDLERS.has(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log(`Removed ${removed} daily/store-meta trigger(s)`);
}

/**
 * Installs THREE live triggers (Phase 5.1 split) — one per store.
 *
 * Each runs every 15 minutes in its own execution context, so each
 * gets its own 6-min budget. Mirrors the daily split (Phase 5 — 05-01)
 * that fixed the same quota-cascade problem for the 00:05 daily
 * trigger. Without this split, the historical 19% failure rate of
 * the single combined trigger continues.
 *
 * Apps Script's everyMinutes(15) doesn't offer a minute-offset knob,
 * so all 3 fire at the same scheduled instant. That's fine: each
 * execution is INDEPENDENT (its own 6-min budget, its own Sheets
 * API context). Short-window quota contention is bounded because
 * each execution only handles 1 store's worth of API calls.
 *
 * Unlike the old installer, this one does NOT run any of the
 * functions immediately. The first per-store live update happens at
 * the next 15-minute boundary. Rationale: an immediate sequential
 * burst would defeat the very quota separation we're setting up,
 * and the next firing is at most 15 minutes away.
 */
function installLiveTrigger() {
  removeLiveTrigger();

  ScriptApp.newTrigger('runLiveUpdateUzoshop')
    .timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('runLiveUpdateZolplus')
    .timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('runLiveUpdateUsmile')
    .timeBased().everyMinutes(15).create();

  Logger.log('3 live triggers installed: uzoshop / zolplus / usmile (every 15 minutes)');
  Logger.log('First run at next 15-min boundary. To refresh today now, run runLiveUpdate from the editor.');
}

/**
 * Removes ALL handlers that the live-trigger installer knows about,
 * including the legacy single-trigger handler ('runLiveUpdate') so a
 * re-install after deploying Phase 5.1 doesn't leave the old trigger
 * orphaned. installDailyTrigger remains untouched.
 */
function removeLiveTrigger() {
  const HANDLERS = new Set([
    'runLiveUpdate',          // legacy — pre-Phase-5.1
    'runLiveUpdateUzoshop',
    'runLiveUpdateZolplus',
    'runLiveUpdateUsmile',
  ]);
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const t of triggers) {
    if (HANDLERS.has(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log(`Removed ${removed} live trigger(s)`);
}

/**
 * הצגת תפריט בתוך הגיליון (נטען כשפותחים את הגיליון).
 * עובד רק אם הגיליון נפתח אחרי שהפעלת setupCreateSheet ופתחת אותו לפחות פעם אחת.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('ROAS')
      .addItem('הרץ עדכון ליום אתמול', 'runDailyUpdate')
      .addItem('הרץ לתאריך מסוים…', 'promptRunForDate_')
      .addItem('מילוי היסטורי (טווח)…', 'promptBackfill_')
      .addSeparator()
      .addItem('התקן טריגר יומי (00:05) + הרצה מיידית', 'installDailyTrigger')
      .addItem('הסר טריגר יומי', 'removeDailyTrigger')
      .addItem('התקן טריגר Live (כל 15 דקות)', 'installLiveTrigger')
      .addItem('הסר טריגר Live', 'removeLiveTrigger')
      .addSeparator()
      .addItem('הסתר טאבים עזריים', 'hideAuxiliaryTabs')
      .addItem('הצג טאבים עזריים (debug)', 'showAuxiliaryTabs')
      .addSeparator()
      .addItem('ארכוב יבש: dry-run 18 חודש (Phase 5)', 'archive18MonthsDryRun')
      .addItem('ארכוב production 18 חודש (אחרי dry-run!)', 'archive18MonthsProduction')
      .addSeparator()
      .addItem('פתח טאב Override ידני (manual-spend)', 'openManualSpendTab')
      .addSeparator()
      .addItem('בדוק הגדרות (verifyConfig)', 'showVerifyConfig_')
      .addItem('הוצא Shopify tokens (Client Credentials)', 'bootstrapAllShopifyTokens')
      .addItem('פתח גיליון הגדרות', 'showSpreadsheetUrl_')
      .addToUi();
  } catch (_) { /* not in spreadsheet context */ }
}

function promptRunForDate_() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('הרצה לתאריך מסוים', 'פורמט: YYYY-MM-DD', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const date = res.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { ui.alert('תאריך לא תקין'); return; }
  runUpdateForDate(date);
  ui.alert('בוצע: ' + date);
}

function promptBackfill_() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('תאריך התחלה', 'YYYY-MM-DD', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const b = ui.prompt('תאריך סיום', 'YYYY-MM-DD', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  backfillRange(a.getResponseText().trim(), b.getResponseText().trim());
  ui.alert('הסתיים מילוי היסטורי');
}

function showSpreadsheetUrl_() {
  const ss = ensureSpreadsheet();
  SpreadsheetApp.getUi().alert(ss.getUrl());
}

function showVerifyConfig_() {
  const msg = verifyConfig();
  SpreadsheetApp.getUi().alert('Verify Config', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

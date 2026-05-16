/**
 * Main.gs - נקודות כניסה: setup, triggers, menu.
 */

/**
 * הפעל פעם אחת ידנית מעורך Apps Script לאחר השלמת Script Properties.
 * יוצר את הגיליון (אם לא קיים), בונה טאבים, מתקין טריגר יומי.
 */
function setupAll() {
  const ss = ensureSpreadsheet();
  installDailyTrigger();
  Logger.log('================================');
  Logger.log('Setup complete.');
  Logger.log('Spreadsheet URL: ' + ss.getUrl());
  Logger.log('Daily trigger: every day at 00:05 Asia/Jerusalem');
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

function installDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('runDailyUpdate')
    .timeBased()
    .atHour(0)
    .nearMinute(5)
    .everyDays(1)
    .inTimezone(TZ)
    .create();
  Logger.log('Daily trigger installed: 00:05 Asia/Jerusalem');

  // הרצה מיידית עבור היום הקודם, כדי לא לחכות עד 00:05 מחר.
  // אם נכשל - הטריגר עדיין מתוזמן, רק לוג של השגיאה.
  try {
    Logger.log('Running daily update now for yesterday...');
    runDailyUpdate();
  } catch (e) {
    Logger.log(`Immediate run failed: ${e && e.message ? e.message : e}. Scheduled trigger remains active.`);
  }
}

function removeDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'runDailyUpdate') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log(`Removed ${removed} trigger(s)`);
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
      .addSeparator()
      .addItem('הסתר טאבים עזריים', 'hideAuxiliaryTabs')
      .addItem('הצג טאבים עזריים (debug)', 'showAuxiliaryTabs')
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

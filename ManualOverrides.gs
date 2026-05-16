/**
 * ManualOverrides.gs - אפשרות להחליף נתוני הוצאת פרסום ידנית, לפי תאריך/חנות/פלטפורמה.
 *
 * שימוש: כשחשבון מודעות הושבת, פג תוקף, או כל סיבה אחרת שמונעת מ-API להחזיר
 * נתונים אמינים לטווח תאריכים מסוים — מילוי הטאב `manual-spend` יגרום לסקריפט
 * להשתמש בערכים שלך **במקום** לקרוא ל-API.
 *
 * הטאב נוצר אוטומטית בהרצה הראשונה של setupAll או בלחיצה על "פתח טאב Override
 * ידני" בתפריט.
 *
 * **חשוב**: בכל ריצה (יומית/לייב/backfill), הסקריפט בודק את הטאב הזה לפני
 * שהוא קורא ל-Meta/Google API. אם נמצאה שורה עם (תאריך, חנות, פלטפורמה) תואמים
 * — הערך מהטאב נכנס לחישוב, וה-API לא נקרא.
 */

const MANUAL_SPEND_TAB = 'manual-spend';
const MANUAL_SPEND_HEADERS = ['Date', 'Store ID', 'Platform', 'Spend', 'Currency', 'Notes'];

function ensureManualSpendTab_(ss) {
  let sh = ss.getSheetByName(MANUAL_SPEND_TAB);
  if (!sh) {
    sh = ss.insertSheet(MANUAL_SPEND_TAB);
    sh.setRightToLeft(false);
    sh.getRange(1, 1, 1, MANUAL_SPEND_HEADERS.length)
      .setValues([MANUAL_SPEND_HEADERS])
      .setFontWeight('bold')
      .setBackground('#8e44ad')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 110);  // Date
    sh.setColumnWidth(2, 110);  // Store ID
    sh.setColumnWidth(3, 90);   // Platform
    sh.setColumnWidth(4, 110);  // Spend
    sh.setColumnWidth(5, 90);   // Currency
    sh.setColumnWidth(6, 340);  // Notes

    // הצמדת validation כדי למנוע טעויות מקלדת.
    const storeIds = STORES.map(s => s.id);
    const storeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(storeIds, true)
      .setAllowInvalid(false)
      .setHelpText('בחר מזהה חנות תקין: ' + storeIds.join(', '))
      .build();
    sh.getRange(2, 2, 1000, 1).setDataValidation(storeRule);

    const platformRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Meta', 'Google'], true)
      .setAllowInvalid(false)
      .setHelpText('Meta או Google')
      .build();
    sh.getRange(2, 3, 1000, 1).setDataValidation(platformRule);

    const currencyRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['ILS', 'CAD', 'USD', 'EUR'], true)
      .setAllowInvalid(false)
      .setHelpText('מטבע הסכום שהכנסת')
      .build();
    sh.getRange(2, 5, 1000, 1).setDataValidation(currencyRule);

    sh.getRange(2, 1, 1000, 1).setNumberFormat('yyyy-mm-dd');
    sh.getRange(2, 4, 1000, 1).setNumberFormat('#,##0.00');
  }
  return sh;
}

// משתנה ברמת ה-script run: נטען פעם אחת ב-backfill ארוך כדי לא לקרוא את הטאב 30 פעם.
// Apps Script מאפס אותו אוטומטית בין הרצות.
let _manualOverridesCache_ = null;

function getManualSpendOverride_(storeId, platform, dateStr) {
  if (_manualOverridesCache_ === null) {
    _manualOverridesCache_ = loadManualOverrides_();
  }
  const key = `${storeId}|${platform}|${dateStr}`;
  return _manualOverridesCache_[key] || null;
}

function loadManualOverrides_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || ensureSpreadsheet();
    const sh = ss.getSheetByName(MANUAL_SPEND_TAB);
    if (!sh) return {};
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return {};
    const data = sh.getRange(2, 1, lastRow - 1, MANUAL_SPEND_HEADERS.length).getValues();
    const map = {};
    let loaded = 0;
    for (const row of data) {
      const dateRaw = row[0];
      let dateStr = null;
      if (dateRaw instanceof Date && !isNaN(dateRaw.getTime())) {
        dateStr = Utilities.formatDate(dateRaw, TZ, 'yyyy-MM-dd');
      } else if (typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateRaw)) {
        dateStr = dateRaw.slice(0, 10);
      }
      if (!dateStr) continue;

      const storeId = String(row[1] || '').trim();
      const platform = String(row[2] || '').trim();
      const spendRaw = row[3];
      const currency = String(row[4] || 'ILS').trim().toUpperCase();

      if (!storeId || !platform) continue;
      // 0 הוא ערך תקין (אומר "ביום הזה לא היו הוצאות"). null/undefined/'' = לא להחליף.
      if (spendRaw === '' || spendRaw === null || spendRaw === undefined) continue;
      const spend = parseFloat(spendRaw);
      if (!Number.isFinite(spend)) continue;

      map[`${storeId}|${platform}|${dateStr}`] = { spend, currency };
      loaded++;
    }
    if (loaded > 0) Logger.log(`Manual overrides loaded: ${loaded} rows`);
    return map;
  } catch (e) {
    Logger.log(`loadManualOverrides_ failed (treating as empty): ${e && e.message ? e.message : e}`);
    return {};
  }
}

/**
 * עוזר להוספה בכמות (במקום להקליד שורה-שורה בגיליון).
 *
 * דוגמת שימוש להזנת Meta של uzoshop באפריל:
 *
 *   function addUzoshopAprilMeta() {
 *     bulkAddManualOverrides('uzoshop', 'Meta', 'ILS', [
 *       ['2026-04-01', 350],
 *       ['2026-04-02', 412],
 *       // ... המשך לכל הימים
 *     ], 'old account deactivated 8.5');
 *   }
 *
 * אם שורה לאותו (date, storeId, platform) כבר קיימת, היא תעודכן (לא תיווצר כפילות).
 *
 * @param storeId      'uzoshop' / 'zolplus' / 'usmile360'
 * @param platform     'Meta' / 'Google'
 * @param currency     'ILS' / 'CAD' / 'USD' / 'EUR'
 * @param entries      מערך של [dateStr, spend] לדוגמה [['2026-04-01', 350]]
 * @param notes        טקסט חופשי שיופיע בעמודת Notes
 */
function bulkAddManualOverrides(storeId, platform, currency, entries, notes) {
  const ss = ensureSpreadsheet();
  const sh = ensureManualSpendTab_(ss);
  notes = notes || '';

  // טען את השורות הקיימות לאיתור כפילויות
  const lastRow = sh.getLastRow();
  const existing = new Map(); // "date|storeId|platform" -> rowNum
  if (lastRow > 1) {
    const data = sh.getRange(2, 1, lastRow - 1, MANUAL_SPEND_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      const v = data[i][0];
      let key = null;
      if (v instanceof Date && !isNaN(v.getTime())) {
        key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        key = v.slice(0, 10);
      }
      if (!key) continue;
      const sid = String(data[i][1] || '').trim();
      const plt = String(data[i][2] || '').trim();
      existing.set(`${key}|${sid}|${plt}`, i + 2); // +2 = header + 1-indexed
    }
  }

  let updated = 0;
  let appended = 0;
  const toAppend = [];
  for (const [dateStr, spend] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      Logger.log(`Skip invalid date: ${dateStr}`);
      continue;
    }
    const key = `${dateStr}|${storeId}|${platform}`;
    const row = [parseYMD_(dateStr), storeId, platform, parseFloat(spend) || 0, currency, notes];
    if (existing.has(key)) {
      const rowNum = existing.get(key);
      sh.getRange(rowNum, 1, 1, 6).setValues([row]);
      updated++;
    } else {
      toAppend.push(row);
    }
  }
  if (toAppend.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, 6).setValues(toAppend);
    appended = toAppend.length;
  }
  // formatting on the new/updated area
  if (lastRow > 0 || toAppend.length > 0) {
    const total = sh.getLastRow();
    if (total > 1) {
      sh.getRange(2, 1, total - 1, 1).setNumberFormat('yyyy-mm-dd');
      sh.getRange(2, 4, total - 1, 1).setNumberFormat('#,##0.00');
    }
  }
  Logger.log(`bulkAddManualOverrides ${storeId}/${platform}: ${appended} added, ${updated} updated`);
}

/** מתפריט הגיליון - פותח את הטאב כדי שהמשתמש יוכל לערוך. */
function openManualSpendTab() {
  const ss = ensureSpreadsheet();
  const sh = ensureManualSpendTab_(ss);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert(
    'טאב Override ידני נפתח',
    'הוסף שורות עם:\n' +
    '  Date (YYYY-MM-DD) | Store ID | Platform | Spend | Currency | Notes\n\n' +
    'דוגמה:\n' +
    '  2026-04-01 | uzoshop | Meta | 350 | ILS | חשבון ישן\n\n' +
    'אחרי שתסיים, הרץ backfillRange לתאריכים הרלוונטיים — הסקריפט ישתמש בנתונים שלך במקום ב-API.',
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

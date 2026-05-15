/**
 * SheetBuilder.gs - יצירה ותחזוקה של פריסת הגיליון.
 *
 * פריסה לכל טאב (חנות + סיכום):
 *   שורה N+0: כותרת חודש מאוחדת (לדוגמה "מאי 2026")
 *   שורה N+1: כותרות עמודות [תאריך | יצא (CAD) | נכנס (CAD) | ROAS]
 *   שורות N+2..N+1+daysInMonth: שורת נתונים לכל יום בחודש
 *   שורה אחרי: סך הכל
 *   שורה ריקה
 *   ואז הבלוק של החודש הבא...
 *
 * חודשים חדשים מצורפים בסוף; חודשים קודמים לעולם לא נדרסים.
 */

function ensureSpreadsheet() {
  let id = getProp('spreadsheet.id');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      Logger.log(`Saved spreadsheet ID invalid, creating new one. Error: ${e}`);
    }
  }
  const ss = SpreadsheetApp.create('ROAS Tracker - מעקב חנויות');
  ss.setSpreadsheetTimeZone(TZ);
  setProp('spreadsheet.id', ss.getId());

  const tempName = ss.getSheets()[0].getName();
  for (const s of STORES) {
    if (!ss.getSheetByName(s.name)) ss.insertSheet(s.name);
  }
  if (!ss.getSheetByName(SUMMARY_TAB)) ss.insertSheet(SUMMARY_TAB);

  const summary = ss.getSheetByName(SUMMARY_TAB);
  ss.setActiveSheet(summary);
  ss.moveActiveSheet(1);

  const temp = ss.getSheetByName(tempName);
  if (temp && temp.getName() !== SUMMARY_TAB && !STORES.find(s => s.name === temp.getName())) {
    ss.deleteSheet(temp);
  }

  for (const s of [SUMMARY_TAB, ...STORES.map(x => x.name)]) {
    const sh = ss.getSheetByName(s);
    if (sh) {
      sh.setRightToLeft(true);
      ensureRoasColorRules_(sh);
    }
  }

  Logger.log(`Spreadsheet ready: ${ss.getUrl()}`);
  return ss;
}

/**
 * מאתר או יוצר בלוק חודש בטאב נתון; מחזיר את מספר שורת הכותרת של הבלוק.
 */
function getOrCreateMonthBlock_(sheet, year, month) {
  const title = `${monthNameHe_(month)} ${year}`;
  const lastRow = sheet.getLastRow();

  if (lastRow > 0) {
    const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
    for (let i = 0; i < colA.length; i++) {
      if (colA[i][0] === title) return i + 1;
    }
  }

  const titleRow = lastRow === 0 ? 1 : lastRow + 2;
  createMonthBlock_(sheet, titleRow, year, month, title);
  return titleRow;
}

function createMonthBlock_(sheet, titleRow, year, month, title) {
  const daysInMonth = new Date(year, month, 0).getDate();

  sheet.getRange(titleRow, 1, 1, 4).merge()
    .setValue(title)
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(14)
    .setBackground('#434343')
    .setFontColor('#ffffff');

  const headerRow = titleRow + 1;
  sheet.getRange(headerRow, 1, 1, 4)
    .setValues([['תאריך', 'יצא (CAD)', 'נכנס (CAD)', 'ROAS']])
    .setFontWeight('bold')
    .setBackground('#d9d9d9')
    .setHorizontalAlignment('center');

  const dataStart = headerRow + 1;
  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    rows.push([`${year}-${pad2_(month)}-${pad2_(d)}`, '', '', '']);
  }
  sheet.getRange(dataStart, 1, daysInMonth, 4).setValues(rows);

  sheet.getRange(dataStart, COL.DATE, daysInMonth, 1)
    .setNumberFormat('yyyy-mm-dd')
    .setHorizontalAlignment('center');
  sheet.getRange(dataStart, COL.SPENT, daysInMonth, 2).setNumberFormat('#,##0.00');
  sheet.getRange(dataStart, COL.ROAS, daysInMonth, 1)
    .setNumberFormat('0.00')
    .setHorizontalAlignment('center');

  const totalRow = dataStart + daysInMonth;
  sheet.getRange(totalRow, 1).setValue('סך הכל')
    .setFontWeight('bold').setBackground('#efefef').setHorizontalAlignment('center');
  sheet.getRange(totalRow, COL.SPENT)
    .setFormula(`=SUM(B${dataStart}:B${totalRow - 1})`)
    .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
  sheet.getRange(totalRow, COL.REVENUE)
    .setFormula(`=SUM(C${dataStart}:C${totalRow - 1})`)
    .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
  sheet.getRange(totalRow, COL.ROAS)
    .setFormula(`=IFERROR(C${totalRow}/B${totalRow}, "")`)
    .setNumberFormat('0.00').setFontWeight('bold').setBackground('#efefef')
    .setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 90);
}

/**
 * כותב ערכי הוצאה/הכנסה לתא של יום נתון. אם החודש לא קיים בטאב - יוצר אותו.
 */
function writeDayRow(sheet, year, month, day, spentCad, revenueCad) {
  const titleRow = getOrCreateMonthBlock_(sheet, year, month);
  const headerRow = titleRow + 1;
  const dayRow = headerRow + day;

  sheet.getRange(dayRow, COL.SPENT).setValue(round2_(spentCad));
  sheet.getRange(dayRow, COL.REVENUE).setValue(round2_(revenueCad));
  sheet.getRange(dayRow, COL.ROAS).setFormula(`=IFERROR(C${dayRow}/B${dayRow}, "")`);
}

function round2_(n) {
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * מגדיר עיצוב מותנה על עמודת ROAS לכל הטאב (D1:D5000), פעם אחת.
 * הכללים תקפים גם לחודשים עתידיים שייווצרו.
 */
function ensureRoasColorRules_(sheet) {
  const rangeStr = 'D1:D5000';
  const range = sheet.getRange(rangeStr);

  const keep = sheet.getConditionalFormatRules().filter(r => {
    const ranges = r.getRanges();
    return !ranges.some(rg => rg.getA1Notation() === rangeStr);
  });

  const newRules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(2)
      .setBackground(ROAS_COLORS.red)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(2, 2.6999)
      .setBackground(ROAS_COLORS.orange)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(2.7, 3)
      .setBackground(ROAS_COLORS.green)
      .setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(3)
      .setBackground(ROAS_COLORS.blue)
      .setRanges([range]).build(),
  ];

  sheet.setConditionalFormatRules([...keep, ...newRules]);
}

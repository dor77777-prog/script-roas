/**
 * SheetBuilder.gs - יצירה ותחזוקה של פריסת הגיליון.
 *
 * שני סוגי פריסה:
 *
 *   1) "split" (חנויות שיש להן גם Google Ads) — 6 עמודות:
 *      [תאריך | יצא פייסבוק | יצא גוגל | יצא סה"כ | נכנס | ROAS]
 *
 *   2) "unified" (חנויות בלי Google Ads, וגם טאב הסיכום) — 4 עמודות:
 *      [תאריך | יצא | נכנס | ROAS]
 *
 * חודשים חדשים מצורפים בסוף; חודשים קודמים לעולם לא נדרסים.
 */

function getLayout_(sheetName) {
  const store = STORES.find(s => s.name === sheetName);
  if (store && store.hasGoogleAds) {
    return {
      type: 'split',
      cols: 6,
      headers: ['תאריך', 'יצא פייסבוק (CAD)', 'יצא גוגל (CAD)', 'יצא סה"כ (CAD)', 'נכנס (CAD)', 'ROAS'],
      fbCol: 2,
      gaCol: 3,
      totalCol: 4,
      revenueCol: 5,
      roasCol: 6,
    };
  }
  return {
    type: 'unified',
    cols: 4,
    headers: ['תאריך', 'יצא (CAD)', 'נכנס (CAD)', 'ROAS'],
    totalCol: 2,
    revenueCol: 3,
    roasCol: 4,
  };
}

function colLetter_(n) {
  return String.fromCharCode(64 + n);
}

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
  const layout = getLayout_(sheet.getName());
  const daysInMonth = new Date(year, month, 0).getDate();
  const cols = layout.cols;

  sheet.getRange(titleRow, 1, 1, cols).merge()
    .setValue(title)
    .setHorizontalAlignment('center')
    .setFontWeight('bold')
    .setFontSize(14)
    .setBackground('#434343')
    .setFontColor('#ffffff');

  const headerRow = titleRow + 1;
  sheet.getRange(headerRow, 1, 1, cols)
    .setValues([layout.headers])
    .setFontWeight('bold')
    .setBackground('#d9d9d9')
    .setHorizontalAlignment('center');

  const dataStart = headerRow + 1;
  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const row = new Array(cols).fill('');
    row[0] = `${year}-${pad2_(month)}-${pad2_(d)}`;
    rows.push(row);
  }
  sheet.getRange(dataStart, 1, daysInMonth, cols).setValues(rows);

  // date column
  sheet.getRange(dataStart, 1, daysInMonth, 1)
    .setNumberFormat('yyyy-mm-dd')
    .setHorizontalAlignment('center');

  // currency columns (everything between date and ROAS)
  const currencyCols = layout.roasCol - 2;
  if (currencyCols > 0) {
    sheet.getRange(dataStart, 2, daysInMonth, currencyCols).setNumberFormat('#,##0.00');
  }

  // ROAS column
  sheet.getRange(dataStart, layout.roasCol, daysInMonth, 1)
    .setNumberFormat('0.00')
    .setHorizontalAlignment('center');

  // total row
  const totalRow = dataStart + daysInMonth;
  sheet.getRange(totalRow, 1).setValue('סך הכל')
    .setFontWeight('bold').setBackground('#efefef').setHorizontalAlignment('center');

  if (layout.type === 'split') {
    // FB, GA columns -> SUM
    sheet.getRange(totalRow, layout.fbCol)
      .setFormula(`=SUM(${colLetter_(layout.fbCol)}${dataStart}:${colLetter_(layout.fbCol)}${totalRow - 1})`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    sheet.getRange(totalRow, layout.gaCol)
      .setFormula(`=SUM(${colLetter_(layout.gaCol)}${dataStart}:${colLetter_(layout.gaCol)}${totalRow - 1})`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    // Total column = FB total + GA total
    sheet.getRange(totalRow, layout.totalCol)
      .setFormula(`=${colLetter_(layout.fbCol)}${totalRow}+${colLetter_(layout.gaCol)}${totalRow}`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    // Revenue column
    sheet.getRange(totalRow, layout.revenueCol)
      .setFormula(`=SUM(${colLetter_(layout.revenueCol)}${dataStart}:${colLetter_(layout.revenueCol)}${totalRow - 1})`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    // ROAS column = revenue / total
    sheet.getRange(totalRow, layout.roasCol)
      .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${totalRow}/${colLetter_(layout.totalCol)}${totalRow}, "")`)
      .setNumberFormat('0.00').setFontWeight('bold').setBackground('#efefef')
      .setHorizontalAlignment('center');
  } else {
    sheet.getRange(totalRow, layout.totalCol)
      .setFormula(`=SUM(${colLetter_(layout.totalCol)}${dataStart}:${colLetter_(layout.totalCol)}${totalRow - 1})`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    sheet.getRange(totalRow, layout.revenueCol)
      .setFormula(`=SUM(${colLetter_(layout.revenueCol)}${dataStart}:${colLetter_(layout.revenueCol)}${totalRow - 1})`)
      .setNumberFormat('#,##0.00').setFontWeight('bold').setBackground('#efefef');
    sheet.getRange(totalRow, layout.roasCol)
      .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${totalRow}/${colLetter_(layout.totalCol)}${totalRow}, "")`)
      .setNumberFormat('0.00').setFontWeight('bold').setBackground('#efefef')
      .setHorizontalAlignment('center');
  }

  // column widths
  sheet.setColumnWidth(1, 110);
  for (let c = 2; c < layout.roasCol; c++) sheet.setColumnWidth(c, 130);
  sheet.setColumnWidth(layout.roasCol, 90);
}

/**
 * כותב נתוני יום לתא. אם החודש לא קיים בטאב - יוצר אותו.
 *
 * @param sheet      טאב היעד
 * @param year/month/day  התאריך
 * @param fbSpentCad      הוצאת פייסבוק ב-CAD (גם בלייאאוט unified - יסוכם עם ga)
 * @param gaSpentCad      הוצאת Google Ads ב-CAD (0 לחנויות ללא GA)
 * @param revenueCad      הכנסות ב-CAD
 */
function writeDayRow(sheet, year, month, day, fbSpentCad, gaSpentCad, revenueCad) {
  const layout = getLayout_(sheet.getName());
  const titleRow = getOrCreateMonthBlock_(sheet, year, month);
  const headerRow = titleRow + 1;
  const dayRow = headerRow + day;

  if (layout.type === 'split') {
    sheet.getRange(dayRow, layout.fbCol).setValue(round2_(fbSpentCad || 0));
    sheet.getRange(dayRow, layout.gaCol).setValue(round2_(gaSpentCad || 0));
    sheet.getRange(dayRow, layout.totalCol)
      .setFormula(`=${colLetter_(layout.fbCol)}${dayRow}+${colLetter_(layout.gaCol)}${dayRow}`);
    sheet.getRange(dayRow, layout.revenueCol).setValue(round2_(revenueCad));
    sheet.getRange(dayRow, layout.roasCol)
      .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${dayRow}/${colLetter_(layout.totalCol)}${dayRow}, "")`);
  } else {
    sheet.getRange(dayRow, layout.totalCol).setValue(round2_((fbSpentCad || 0) + (gaSpentCad || 0)));
    sheet.getRange(dayRow, layout.revenueCol).setValue(round2_(revenueCad));
    sheet.getRange(dayRow, layout.roasCol)
      .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${dayRow}/${colLetter_(layout.totalCol)}${dayRow}, "")`);
  }
}

function round2_(n) {
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * עיצוב מותנה על עמודת ROAS לכל הטאב. הכללים חלים גם לחודשים עתידיים.
 */
function ensureRoasColorRules_(sheet) {
  const layout = getLayout_(sheet.getName());
  const letter = colLetter_(layout.roasCol);
  const rangeStr = `${letter}1:${letter}5000`;
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

/**
 * מנקה את כל התוכן של טאב חנות (כולל פורמטים) — שימושי כשמשנים פריסה.
 * אחרי הריצה, ההפעלה הבאה של runUpdateForDate / backfillRange תיצור את הבלוקים מחדש.
 */
function resetTab(tabName) {
  const ss = ensureSpreadsheet();
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error(`לא נמצא טאב: ${tabName}`);
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setRightToLeft(true);
  ensureRoasColorRules_(sh);
  Logger.log(`Reset tab: ${tabName}`);
}

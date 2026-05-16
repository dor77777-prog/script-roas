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
  if (sheetName === SUMMARY_TAB) {
    // טאב הסיכום: 4 עמודות, נוסחאות שמסכמות את כל החנויות דרך VLOOKUP.
    // אין צורך לקרוא לפונקציות API - הסיכום מתעדכן בזמן אמת אוטומטית.
    return {
      type: 'summary',
      cols: 4,
      headers: ['תאריך', 'יצא סה"כ (CAD)', 'נכנס סה"כ (CAD)', 'ROAS'],
      totalCol: 2,
      revenueCol: 3,
      roasCol: 4,
      formulaDriven: true,
    };
  }
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

/**
 * מחזיר נוסחאות סיכום ליום ספציפי בטאב סיכום.
 * dateCell: התא בטאב הסיכום שמכיל את התאריך (לדוגמה 'A5')
 * הנוסחה תסכום את עמודות "total" ו"revenue" מכל החנויות לפי VLOOKUP על התאריך.
 */
function summaryFormulasForRow_(dateCell) {
  const spentParts = [];
  const revenueParts = [];
  for (const store of STORES) {
    const layout = getLayout_(store.name);
    const tabName = store.name;
    // ציטוט שם הטאב אם יש בו רווח או תווים מיוחדים
    const tabRef = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
    const range = `${tabRef}!A:Z`;
    spentParts.push(`IFERROR(VLOOKUP(${dateCell}, ${range}, ${layout.totalCol}, FALSE), 0)`);
    revenueParts.push(`IFERROR(VLOOKUP(${dateCell}, ${range}, ${layout.revenueCol}, FALSE), 0)`);
  }
  return {
    spent: '=' + spentParts.join('+'),
    revenue: '=' + revenueParts.join('+'),
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

  // לטאב הסיכום - מאכלס נוסחאות לכל יום אוטומטית (live aggregation)
  if (layout.formulaDriven && layout.type === 'summary') {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayRow = dataStart + d - 1;
      const dateCell = `A${dayRow}`;
      const formulas = summaryFormulasForRow_(dateCell);
      sheet.getRange(dayRow, layout.totalCol).setFormula(formulas.spent);
      sheet.getRange(dayRow, layout.revenueCol).setFormula(formulas.revenue);
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${dayRow}/${colLetter_(layout.totalCol)}${dayRow}, "")`);
    }
  }
  // לטאבי חנויות - מאכלסים נוסחאות "סה"כ" ו"ROAS" מראש לכל יום, כך שהזנה ידנית
  // בעמודות FB/GA/Revenue תחושב אוטומטית גם בלי שהקוד יגע ביום הזה.
  else if (layout.type === 'split') {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayRow = dataStart + d - 1;
      const fbRef = `${colLetter_(layout.fbCol)}${dayRow}`;
      const gaRef = `${colLetter_(layout.gaCol)}${dayRow}`;
      const totalRef = `${colLetter_(layout.totalCol)}${dayRow}`;
      const revRef = `${colLetter_(layout.revenueCol)}${dayRow}`;
      sheet.getRange(dayRow, layout.totalCol)
        .setFormula(`=IF(COUNT(${fbRef},${gaRef})=0, "", ${fbRef}+${gaRef})`);
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${revRef}/${totalRef}, "")`);
    }
  } else if (layout.type === 'unified') {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayRow = dataStart + d - 1;
      const totalRef = `${colLetter_(layout.totalCol)}${dayRow}`;
      const revRef = `${colLetter_(layout.revenueCol)}${dayRow}`;
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${revRef}/${totalRef}, "")`);
    }
  }

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
  // הסיכום מבוסס נוסחאות - הקריאה כאן רק מבטיחה שהחודש קיים בטאב.
  // הנוסחאות שנכתבו ב-createMonthBlock_ ימשכו את הערכים אוטומטית מהטאבים האחרים.
  if (layout.formulaDriven) {
    getOrCreateMonthBlock_(sheet, year, month);
    return;
  }

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
 * האם הערך הזה הוא תאריך-יום בעמודה A של בלוק חודש?
 * Google Sheets לפעמים שומר את התאריך כ-Date object (אחרי המרה אוטומטית מ-string)
 * ולפעמים כ-string. תומך בשניהם.
 */
function isDayRowValue_(val) {
  if (val instanceof Date) return !isNaN(val.getTime());
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
  return false;
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
 * מנקה את כל התוכן של טאב נתון (כולל פורמטים) - שימושי כשמשנים פריסה.
 * אחרי הריצה, ההפעלה הבאה של runUpdateForDate / backfillRange תיצור את הבלוקים מחדש.
 *
 * ⚠️ ב-Apps Script לא ניתן להעביר פרמטרים דרך כפתור Run. השתמש בפונקציות
 * ה-wrapper המוכנות מתחת (resetUzoshopTab / resetZolplusTab וכו') במקום
 * לקרוא ישירות ל-resetTab().
 */
function resetTab(tabName) {
  if (!tabName) {
    throw new Error('resetTab: חסר שם טאב. השתמש ב-resetUzoshopTab / resetZolplusTab / resetUsmile360Tab / resetSummaryTab במקום.');
  }
  const ss = ensureSpreadsheet();
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error(`לא נמצא טאב: ${tabName}`);
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setRightToLeft(true);
  ensureRoasColorRules_(sh);
  Logger.log(`Reset tab: ${tabName}`);
}

/** קיצורי דרך נוחים - אפשר להריץ ישירות מ-Apps Script editor. */
function resetUzoshopTab()    { resetTab('uzoshop'); }
function resetZolplusTab()    { resetTab('Zol Plus'); }
function resetUsmile360Tab()  { resetTab('360usmile'); }
function resetSummaryTab()    { resetTab(SUMMARY_TAB); }

/**
 * מאתר כל שורת יום (תאריך YYYY-MM-DD בעמודה A) ומבטיח שיש בה את נוסחאות
 * "סה"כ" ו"ROAS" המתאימות לפריסת הטאב. לא מוחק ערכים קיימים בעמודות FB/GA/Revenue.
 *
 * שימושי כשהזנת ידנית ערכים בתאריכים שהקוד לא נגע בהם.
 */
function repairFormulasInTab(tabName) {
  if (!tabName) {
    throw new Error('repairFormulasInTab: חסר שם טאב. השתמש ב-repairUzoshopFormulas וכו\'.');
  }
  const ss = ensureSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error(`לא נמצא טאב: ${tabName}`);
  const layout = getLayout_(tabName);
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    Logger.log(`Tab ${tabName} is empty - nothing to repair`);
    return;
  }

  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  let repaired = 0;
  for (let i = 0; i < colA.length; i++) {
    if (!isDayRowValue_(colA[i][0])) continue;
    const dayRow = i + 1;

    if (layout.type === 'split') {
      const fbRef = `${colLetter_(layout.fbCol)}${dayRow}`;
      const gaRef = `${colLetter_(layout.gaCol)}${dayRow}`;
      const totalRef = `${colLetter_(layout.totalCol)}${dayRow}`;
      const revRef = `${colLetter_(layout.revenueCol)}${dayRow}`;
      sheet.getRange(dayRow, layout.totalCol)
        .setFormula(`=IF(COUNT(${fbRef},${gaRef})=0, "", ${fbRef}+${gaRef})`);
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${revRef}/${totalRef}, "")`);
      repaired++;
    } else if (layout.type === 'unified') {
      const totalRef = `${colLetter_(layout.totalCol)}${dayRow}`;
      const revRef = `${colLetter_(layout.revenueCol)}${dayRow}`;
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${revRef}/${totalRef}, "")`);
      repaired++;
    } else if (layout.type === 'summary') {
      const dateCell = `A${dayRow}`;
      const formulas = summaryFormulasForRow_(dateCell);
      sheet.getRange(dayRow, layout.totalCol).setFormula(formulas.spent);
      sheet.getRange(dayRow, layout.revenueCol).setFormula(formulas.revenue);
      sheet.getRange(dayRow, layout.roasCol)
        .setFormula(`=IFERROR(${colLetter_(layout.revenueCol)}${dayRow}/${colLetter_(layout.totalCol)}${dayRow}, "")`);
      repaired++;
    }
  }
  Logger.log(`Repaired formulas in ${repaired} day-rows of "${tabName}"`);
}

/** קיצורי דרך - הרץ ישירות מ-Apps Script editor. */
function repairUzoshopFormulas()    { repairFormulasInTab('uzoshop'); }
function repairZolplusFormulas()    { repairFormulasInTab('Zol Plus'); }
function repairUsmile360Formulas()  { repairFormulasInTab('360usmile'); }
function repairSummaryFormulas()    { repairFormulasInTab(SUMMARY_TAB); }

/** מתקן נוסחאות בכל הטאבים בבת אחת. */
function repairAllFormulas() {
  repairUzoshopFormulas();
  repairZolplusFormulas();
  repairUsmile360Formulas();
  repairSummaryFormulas();
}

/**
 * סורק טווח תאריכים בטאב ומדפיס לכל יום אם יש בו את כל הערכים הנדרשים.
 * שימושי כדי לוודא שלא פספסת ימים.
 *
 * דוגמה: verifyTabDataInRange('uzoshop', '2026-05-08', '2026-05-14')
 */
function verifyTabDataInRange(tabName, startDateStr, endDateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
    throw new Error('תאריכים לא תקינים');
  }
  const ss = ensureSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error(`לא נמצא טאב: ${tabName}`);
  const layout = getLayout_(tabName);

  // אנדקס דירוגי יום לפי תאריך
  const lastRow = sheet.getLastRow();
  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  const dateToRow = {};
  for (let i = 0; i < colA.length; i++) {
    const v = colA[i][0];
    let key = null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      key = Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      key = v;
    }
    if (key) dateToRow[key] = i + 1;
  }

  const lines = [];
  lines.push(`=== Verify "${tabName}" from ${startDateStr} to ${endDateStr} ===`);
  let issues = 0;
  let cur = startDateStr;
  while (cur <= endDateStr) {
    const row = dateToRow[cur];
    if (!row) {
      lines.push(`${cur}: ✗ שורה לא קיימת בטאב`);
      issues++;
    } else {
      const lastCol = layout.cols;
      const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
      const status = [];
      let dayOk = true;

      if (layout.type === 'split') {
        const fb = values[layout.fbCol - 1];
        const ga = values[layout.gaCol - 1];
        const rev = values[layout.revenueCol - 1];
        status.push(`FB=${fb === '' || fb === null ? '✗' : fb}`);
        status.push(`GA=${ga === '' || ga === null ? '✗' : ga}`);
        status.push(`Rev=${rev === '' || rev === null ? '✗' : rev}`);
        if (fb === '' || fb === null) dayOk = false;
        if (ga === '' || ga === null) dayOk = false;
        if (rev === '' || rev === null) dayOk = false;
      } else if (layout.type === 'unified') {
        const total = values[layout.totalCol - 1];
        const rev = values[layout.revenueCol - 1];
        status.push(`Total=${total === '' || total === null ? '✗' : total}`);
        status.push(`Rev=${rev === '' || rev === null ? '✗' : rev}`);
        if (total === '' || total === null) dayOk = false;
        if (rev === '' || rev === null) dayOk = false;
      }
      lines.push(`${cur}: ${dayOk ? '✓' : '✗'} (row ${row})  ${status.join('  ')}`);
      if (!dayOk) issues++;
    }
    cur = nextDayStr_(cur);
  }
  lines.push('');
  if (issues === 0) {
    lines.push(`✓ כל הימים מלאים`);
  } else {
    lines.push(`✗ ${issues} ימים עם חוסרים - הרץ backfillRange על התאריכים האלה`);
  }
  const msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}

/** קיצור דרך: בדיקת uzoshop בטווח 2026-05-08 עד 2026-05-14. */
function verifyUzoshopMay8to14() {
  return verifyTabDataInRange('uzoshop', '2026-05-08', '2026-05-14');
}

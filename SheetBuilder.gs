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
  const id = getProp('spreadsheet.id');
  let ss;
  if (id) {
    // Critical: distinguish "spreadsheet truly doesn't exist" from transient
    // failures (network blip, Sheets API rate-limit, timeout). The original
    // version conflated all errors into "create a new one", which silently
    // forked the data into a phantom sheet whenever Apps Script's runtime
    // hit a timeout. We now retry with backoff and only treat persistent
    // permission/not-found errors as a real reason to recreate.
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        ss = SpreadsheetApp.openById(id);
        break;
      } catch (e) {
        lastErr = e;
        const msg = e && e.message ? e.message : String(e);
        const transient =
          /timed out|timeout|rate limit|Internal error|backend|temporarily|try again/i.test(msg);
        if (!transient) {
          // True "not found" / "no permission" → fall through to creation.
          Logger.log(`Saved spreadsheet ID rejected (permanent): ${msg}`);
          break;
        }
        Logger.log(`Saved spreadsheet open attempt ${attempt}/3 transient error: ${msg}. Retrying...`);
        Utilities.sleep(2000 * attempt);
      }
    }
    if (!ss && lastErr) {
      const msg = lastErr.message ? lastErr.message : String(lastErr);
      // If we're still hitting transient errors after 3 tries, THROW —
      // do NOT fall through to creating a new spreadsheet. The user's data
      // is safe in the original sheet; we'll just fail this run and retry
      // on the next trigger. Creating a new sheet would silently lose data.
      if (/timed out|timeout|rate limit|Internal error|backend|temporarily|try again/i.test(msg)) {
        throw new Error(
          `Cannot open spreadsheet ${id} after 3 retries — transient error: ${msg}. ` +
          `Aborting run to protect existing data. Check Sheets API status, then retry.`
        );
      }
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('ROAS Tracker - מעקב חנויות');
    ss.setSpreadsheetTimeZone(TZ);
    setProp('spreadsheet.id', ss.getId());

    const tempName = ss.getSheets()[0].getName();
    const temp = ss.getSheetByName(tempName);
    if (temp) { try { ss.deleteSheet(temp); } catch (_) {} }
  }

  // טאבי סיכום + חנות (אם לא קיימים)
  if (!ss.getSheetByName(SUMMARY_TAB)) ss.insertSheet(SUMMARY_TAB);
  for (const s of STORES) {
    if (!ss.getSheetByName(s.name)) ss.insertSheet(s.name);
    const campTab = campaignTabName_(s.id);
    if (!ss.getSheetByName(campTab)) {
      const sh = ss.insertSheet(campTab);
      ensureCampaignTabHeaders_(sh);
      // טאבי קמפיינים מוסתרים מהמשתמש כברירת מחדל (נתונים מסביב מנותחים בדשבורד)
      try { sh.hideSheet(); } catch (_) {}
    }
  }

  // הצב את הסיכום בראש
  const summary = ss.getSheetByName(SUMMARY_TAB);
  ss.setActiveSheet(summary);
  ss.moveActiveSheet(1);

  // RTL + צבעי ROAS עבור טאבי הסיכום והחנויות (לא על טאבי קמפיינים - מבנה שונה)
  for (const s of [SUMMARY_TAB, ...STORES.map(x => x.name)]) {
    const sh = ss.getSheetByName(s);
    if (sh) {
      sh.setRightToLeft(true);
      ensureRoasColorRules_(sh);
    }
  }

  // RTL + צבעי ROAS לטאבי הקמפיינים (עמודה L = ROAS)
  for (const s of STORES) {
    const sh = ss.getSheetByName(campaignTabName_(s.id));
    if (sh) {
      sh.setRightToLeft(true);
      ensureCampaignRoasColorRules_(sh);
    }
  }

  // טאב נתונים שטוחים ל-Looker Studio (LTR, English headers)
  ensureDailyFlatTab_(ss);

  // טאב store-meta: שם תוכנית Shopify לכל חנות. מתעדכן ע"י refreshAllStoreMeta().
  ensureStoreMetaTab_(ss);

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
 * מסתיר את כל הטאבים העזריים (נתונים גולמיים, helpers).
 * משאיר רק: סיכום, חנויות, Dashboard.
 * שימושי אחרי עדכון מגרסה ישנה.
 */
function hideAuxiliaryTabs() {
  const ss = ensureSpreadsheet();
  const toHide = [
    DAILY_FLAT_TAB,
    DASHBOARD_HELPERS_TAB,
    ...STORES.map(s => campaignTabName_(s.id)),
  ];
  let hidden = 0;
  for (const name of toHide) {
    const sh = ss.getSheetByName(name);
    if (sh) {
      try {
        sh.hideSheet();
        hidden++;
      } catch (_) {}
    }
  }
  Logger.log(`Hidden ${hidden} auxiliary tabs. Visible: סיכום, חנויות, Dashboard.`);
}

/** מציג שוב את כל הטאבים העזריים (אם תרצה לבדוק/לערוך). */
function showAuxiliaryTabs() {
  const ss = ensureSpreadsheet();
  const toShow = [
    DAILY_FLAT_TAB,
    DASHBOARD_HELPERS_TAB,
    ...STORES.map(s => campaignTabName_(s.id)),
  ];
  let shown = 0;
  for (const name of toShow) {
    const sh = ss.getSheetByName(name);
    if (sh) {
      try {
        sh.showSheet();
        shown++;
      } catch (_) {}
    }
  }
  Logger.log(`Shown ${shown} auxiliary tabs.`);
}

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

// ============================================================================
// טאבי קמפיינים (אד-סטים) - שכבת רזולוציה מתחת לסיכום היומי
// ============================================================================

// Cols 1..12 are the original schema; 13..15 added 2026-05 to carry budget
// info per row so the dashboard can show "this is a CBO campaign with
// $50/day" or "this ad-set has $20/day".
const CAMPAIGN_HEADERS = [
  'תאריך', 'פלטפורמה', 'מזהה קמפיין', 'שם קמפיין',
  'מזהה אד-סט', 'שם אד-סט',
  'יצא (CAD)', 'חשיפות', 'קליקים',
  'המרות', 'ערך המרות (CAD)', 'ROAS',
  'תקציב קמפיין (CAD)', 'תקציב אד-סט (CAD)', 'סוג תקציב'
];

function ensureCampaignTabHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CAMPAIGN_HEADERS.length)
      .setValues([CAMPAIGN_HEADERS])
      .setFontWeight('bold')
      .setBackground('#d9d9d9')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 95);    // Date
    sheet.setColumnWidth(2, 80);    // Platform
    sheet.setColumnWidth(3, 120);   // Campaign ID
    sheet.setColumnWidth(4, 260);   // Campaign Name
    sheet.setColumnWidth(5, 120);   // Ad Set ID
    sheet.setColumnWidth(6, 260);   // Ad Set Name
    sheet.setColumnWidth(7, 100);   // Spend
    sheet.setColumnWidth(8, 90);    // Impressions
    sheet.setColumnWidth(9, 70);    // Clicks
    sheet.setColumnWidth(10, 70);   // Conversions
    sheet.setColumnWidth(11, 110);  // Conv Value
    sheet.setColumnWidth(12, 70);   // ROAS
    sheet.setColumnWidth(13, 130);  // Campaign Budget (CAD)
    sheet.setColumnWidth(14, 130);  // Ad Set Budget (CAD)
    sheet.setColumnWidth(15, 100);  // Budget Type
  } else {
    // Older tabs missing cols 13-15: add the headers idempotently. Existing
    // rows will get empty values for the new columns until the next daily
    // refresh writes them.
    const lastCol = sheet.getLastColumn();
    if (lastCol < 15) {
      const labels = ['תקציב קמפיין (CAD)', 'תקציב אד-סט (CAD)', 'סוג תקציב'];
      for (let i = 0; i < 3; i++) {
        const col = 13 + i;
        const cell = sheet.getRange(1, col);
        if (!cell.getValue()) {
          cell.setValue(labels[i])
            .setFontWeight('bold')
            .setBackground('#d9d9d9')
            .setHorizontalAlignment('center');
        }
      }
      sheet.setColumnWidth(13, 130);
      sheet.setColumnWidth(14, 130);
      sheet.setColumnWidth(15, 100);
    }
  }
}

function ensureCampaignRoasColorRules_(sheet) {
  const rangeStr = 'L1:L20000';
  const range = sheet.getRange(rangeStr);
  const keep = sheet.getConditionalFormatRules().filter(r => {
    const ranges = r.getRanges();
    return !ranges.some(rg => rg.getA1Notation() === rangeStr);
  });
  const newRules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(2).setBackground(ROAS_COLORS.red).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2, 2.6999).setBackground(ROAS_COLORS.orange).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2.7, 3).setBackground(ROAS_COLORS.green).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(3).setBackground(ROAS_COLORS.blue).setRanges([range]).build(),
  ];
  sheet.setConditionalFormatRules([...keep, ...newRules]);
}

/**
 * כותב שורות אד-סט לטאב הקמפיינים של חנות ליום נתון.
 * Idempotent - שורות קיימות לאותו תאריך נדרסות.
 *
 * אופטימיזציה: כל הפעולות ב-batch (קריאה אחת + כתיבה אחת), במקום deleteRow בלולאה.
 * זה הופך את הריצה מ-30+ שניות ל-2-3 שניות גם עבור מאות שורות.
 */
function writeCampaignRowsForDay(ss, storeId, dateStr, rows) {
  const tabName = campaignTabName_(storeId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.setRightToLeft(true);
  }
  ensureCampaignTabHeaders_(sh);
  ensureCampaignRoasColorRules_(sh);

  // שלב 1: קרא את כל הנתונים הקיימים (חוץ מכותרת)
  const lastRow = sh.getLastRow();
  let keptRows = [];
  if (lastRow > 1) {
    const allExisting = sh.getRange(2, 1, lastRow - 1, CAMPAIGN_HEADERS.length).getValues();
    keptRows = allExisting.filter(r => {
      const v = r[0];
      let key = null;
      if (v instanceof Date && !isNaN(v.getTime())) {
        key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        key = v;
      }
      // Preserve rows with unparseable dates rather than silently destroying
      // them — a prior write may have crashed mid-format (setValues OK, then
      // quota timeout before setNumberFormat), leaving valid data in a
      // not-yet-formatted state. Operator can manually fix; the daily
      // overwrite should not delete data it doesn't recognise.
      return key !== dateStr;
    });
  }

  // שלב 2: בנה את השורות החדשות
  const newRowsArr = (rows || []).map(r => [
    parseYMD_(r.date),
    r.platform,
    r.campaignId || '',
    r.campaignName || '',
    r.adSetId || '',
    r.adSetName || '',
    round2_(r.spendCad || 0),
    parseInt(r.impressions || 0, 10),
    parseInt(r.clicks || 0, 10),
    round2_(r.conversions || 0),
    round2_(r.conversionValueCad || 0),
    '', // ROAS - נוסחה
    // Budget enrichment — populated by callers that include budget data on
    // the row (currently MetaAds via getMetaBudgets). Google rows pass null
    // for all three.
    r.campaignBudgetCad != null ? round2_(r.campaignBudgetCad) : '',
    r.adSetBudgetCad != null ? round2_(r.adSetBudgetCad) : '',
    r.budgetType || '',  // 'CBO' | 'ABO' | '' (unknown)
  ]);

  const combined = keptRows.concat(newRowsArr);

  // שלב 3: נקה את כל אזור הנתונים ביעילות
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, CAMPAIGN_HEADERS.length).clearContent();
  }

  if (combined.length === 0) return;

  // שלב 4: כתוב הכל בכתיבה אחת
  // Force long platform IDs to text before writing. Meta IDs can exceed JS
  // number precision if Sheets auto-parses them as numeric cells.
  sh.getRange(2, 3, combined.length, 1).setNumberFormat('@'); // Campaign ID
  sh.getRange(2, 5, combined.length, 1).setNumberFormat('@'); // Ad Set ID
  sh.getRange(2, 1, combined.length, CAMPAIGN_HEADERS.length).setValues(combined);

  // שלב 5: פורמטים על כל אזור הנתונים בבת אחת
  sh.getRange(2, 1, combined.length, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
  sh.getRange(2, 7, combined.length, 1).setNumberFormat('#,##0.00');     // Spend
  sh.getRange(2, 8, combined.length, 2).setNumberFormat('#,##0');         // Impressions, Clicks
  sh.getRange(2, 10, combined.length, 2).setNumberFormat('#,##0.00');     // Conversions, Conv Value
  sh.getRange(2, 12, combined.length, 1).setNumberFormat('0.00').setHorizontalAlignment('center');
  sh.getRange(2, 13, combined.length, 2).setNumberFormat('#,##0.00');     // Campaign Budget, Ad Set Budget
  sh.getRange(2, 15, combined.length, 1).setHorizontalAlignment('center'); // Budget Type

  // שלב 6: נוסחאות ROAS ב-batch אחד
  const formulas = combined.map((_, i) => {
    const r = 2 + i;
    return [`=IFERROR(K${r}/G${r}, "")`];
  });
  sh.getRange(2, 12, combined.length, 1).setFormulas(formulas);
}

// ============================================================================
// Daily-flat data tab - LTR, English headers, optimised for Looker Studio
// ============================================================================

const DAILY_FLAT_HEADERS = [
  'Date', 'Store ID', 'Store', 'FB Spend (CAD)', 'GA Spend (CAD)',
  'Total Spend (CAD)', 'Revenue (CAD)', 'ROAS', 'Gross Profit (CAD)',
  'COGS (CAD)', 'Net Profit (CAD)'
];

function ensureDailyFlatTab_(ss) {
  let sh = ss.getSheetByName(DAILY_FLAT_TAB);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(DAILY_FLAT_TAB);
    sh.setRightToLeft(false);
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, DAILY_FLAT_HEADERS.length).setValues([DAILY_FLAT_HEADERS])
      .setFontWeight('bold')
      .setBackground('#1c4587')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 95);   // Date
    sh.setColumnWidth(2, 90);   // Store ID
    sh.setColumnWidth(3, 110);  // Store Name
    sh.setColumnWidth(4, 110);  // FB Spend
    sh.setColumnWidth(5, 110);  // GA Spend
    sh.setColumnWidth(6, 120);  // Total Spend
    sh.setColumnWidth(7, 110);  // Revenue
    sh.setColumnWidth(8, 70);   // ROAS
    sh.setColumnWidth(9, 110);  // Gross Profit
    sh.setColumnWidth(10, 110); // COGS
    sh.setColumnWidth(11, 110); // Net Profit
  }
  // הסתר את הטאב מהמשתמש - הוא משמש רק כמקור נתונים לדשבורד
  if (justCreated) {
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * כותב/מעדכן שורה בטאב daily-flat. אידמפוטנטי לפי (date, storeId).
 * cogsCad אופציונלי - אם 0/null, השדה יישאר ריק (לא נחשב כ-0).
 */
function writeDailyFlatRow_(ss, dateStr, storeId, storeName, fbCad, gaCad, revenueCad, cogsCad) {
  const sh = ensureDailyFlatTab_(ss);
  const lastRow = sh.getLastRow();
  let targetRow = lastRow + 1;
  let isNew = true;

  if (lastRow > 1) {
    const dataIds = sh.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < dataIds.length; i++) {
      const rowDate = dataIds[i][0];
      const rowStore = dataIds[i][1];
      let dateKey = null;
      if (rowDate instanceof Date && !isNaN(rowDate.getTime())) {
        dateKey = Utilities.formatDate(rowDate, TZ, 'yyyy-MM-dd');
      } else if (typeof rowDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rowDate)) {
        dateKey = rowDate;
      }
      if (dateKey === dateStr && String(rowStore) === storeId) {
        targetRow = i + 2;
        isNew = false;
        break;
      }
    }
  }

  const fb = round2_(fbCad || 0);
  const ga = round2_(gaCad || 0);
  const total = round2_(fb + ga);
  const rev = round2_(revenueCad || 0);
  const cogs = (cogsCad === null || cogsCad === undefined) ? '' : round2_(cogsCad);

  sh.getRange(targetRow, 1, 1, 7).setValues([[
    parseYMD_(dateStr), storeId, storeName, fb, ga, total, rev
  ]]);
  sh.getRange(targetRow, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(targetRow, 8).setFormula(`=IFERROR(G${targetRow}/F${targetRow}, "")`);
  sh.getRange(targetRow, 9).setFormula(`=G${targetRow}-F${targetRow}`);
  sh.getRange(targetRow, 10).setValue(cogs);
  // Net Profit = Revenue - Spend - COGS. אם COGS חסר, ייקח כ-0.
  sh.getRange(targetRow, 11).setFormula(`=G${targetRow}-F${targetRow}-IF(J${targetRow}="",0,J${targetRow})`);

  if (isNew) {
    sh.getRange(targetRow, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
    sh.getRange(targetRow, 4, 1, 3).setNumberFormat('#,##0.00');  // FB, GA, Total
    sh.getRange(targetRow, 7).setNumberFormat('#,##0.00');         // Revenue
    sh.getRange(targetRow, 8).setNumberFormat('0.00').setHorizontalAlignment('center');
    sh.getRange(targetRow, 9).setNumberFormat('#,##0.00');         // Gross Profit
    sh.getRange(targetRow, 10).setNumberFormat('#,##0.00');        // COGS
    sh.getRange(targetRow, 11).setNumberFormat('#,##0.00');        // Net Profit
  }
}

// ----------------------------------------------------------------------------
// store-meta: שם תוכנית Shopify לכל חנות. הדשבורד קורא מכאן ומציע אוטומטית
// "Basic Shopify ≈ $39/mo" כעלות חודשית קבועה ב-BillingSettings. שורה אחת
// לחנות, מעודכן ע"י refreshAllStoreMeta() ב-Shopify.gs.
// ----------------------------------------------------------------------------

// Columns 1..7 are the original schema; 8..9 added 2026-05 to carry the
// platform ad-account IDs so the dashboard can build deep links to the right
// account in Meta / Google Ads (otherwise the links open whatever account
// the user was last viewing, not the campaign's account).
const STORE_META_HEADERS = [
  'Store ID', 'Store', 'Plan Display Name', 'Shopify Plus', 'Partner Dev',
  'Updated At', 'Last Error', 'Meta Ad Account ID', 'Google Ads Customer ID',
];

function ensureStoreMetaTab_(ss) {
  let sh = ss.getSheetByName(STORE_META_TAB);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(STORE_META_TAB);
    sh.setRightToLeft(false);
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, STORE_META_HEADERS.length).setValues([STORE_META_HEADERS])
      .setFontWeight('bold')
      .setBackground('#1c4587')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 100); // Store ID
    sh.setColumnWidth(2, 110); // Store
    sh.setColumnWidth(3, 160); // Plan Display Name
    sh.setColumnWidth(4, 100); // Shopify Plus
    sh.setColumnWidth(5, 100); // Partner Dev
    sh.setColumnWidth(6, 160); // Updated At
    sh.setColumnWidth(7, 360); // Last Error
    sh.setColumnWidth(8, 160); // Meta Ad Account ID
    sh.setColumnWidth(9, 170); // Google Ads Customer ID
  } else {
    // Migrate older sheets: ensure header cells in 7..9 are populated
    // idempotently. Append-only — never re-orders prior columns.
    const headerRow = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), STORE_META_HEADERS.length)).getValues()[0];
    const migrations = [
      { col: 7, expected: 'Last Error', width: 360 },
      { col: 8, expected: 'Meta Ad Account ID', width: 160 },
      { col: 9, expected: 'Google Ads Customer ID', width: 170 },
    ];
    for (const m of migrations) {
      if (String(headerRow[m.col - 1] || '').trim() !== m.expected) {
        sh.getRange(1, m.col).setValue(m.expected)
          .setFontWeight('bold')
          .setBackground('#1c4587')
          .setFontColor('#ffffff')
          .setHorizontalAlignment('center');
        sh.setColumnWidth(m.col, m.width);
      }
    }
  }
  if (justCreated) {
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * כותב/מעדכן שורה ב-store-meta. אידמפוטנטי לפי storeId.
 * plan = { displayName, partnerDevelopment, shopifyPlus } או null אם נכשל.
 * lastError = מחרוזת תיאור הכשל מ-getShopifyPlan, או null אם הצליח. נכתב
 *             לעמודה G כך שה-dashboard יכול להציג למשתמש למה auto-detect
 *             לא עובד (חסר scope / טוקן פג / וכו') במקום לתת התנהגות שותקת.
 *
 * עמודות 8-9 (Meta Ad Account ID, Google Ads Customer ID) נשלפות
 * אוטומטית מ-Script Properties — הם המזהים שכבר הוגדרו בקונפיג של
 * החנות (`${storeId}.meta.adAccountId` / `${storeId}.googleads.customerId`).
 * הם מתפרסמים ל-Sheet כדי שה-dashboard יוכל לבנות קישורים עמוקים
 * נכונים ל-Ads Manager במקום לפתוח את החשבון האחרון של המשתמש.
 */
function writeStoreMetaRow_(ss, storeId, storeName, plan, updatedAt, lastError) {
  const sh = ensureStoreMetaTab_(ss);
  const lastRow = sh.getLastRow();
  let targetRow = lastRow + 1;

  if (lastRow > 1) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === storeId) {
        targetRow = i + 2;
        break;
      }
    }
  }

  const displayName = plan && plan.displayName ? String(plan.displayName) : '';
  const plus = plan ? !!plan.shopifyPlus : '';
  const dev = plan ? !!plan.partnerDevelopment : '';
  const errCell = lastError ? String(lastError) : '';

  // Pull the platform IDs from Script Properties. Meta ad accounts may be
  // stored with the "act_" prefix; strip it because Ads Manager URLs expect
  // the numeric portion only.
  const metaRaw = getProp(`${storeId}.meta.adAccountId`, '');
  const metaId = String(metaRaw || '').replace(/^act_/, '');
  const googleId = String(getProp(`${storeId}.googleads.customerId`, '') || '').replace(/-/g, '');

  sh.getRange(targetRow, 1, 1, 9).setValues([[
    storeId, storeName, displayName, plus, dev, updatedAt, errCell, metaId, googleId,
  ]]);
  sh.getRange(targetRow, 6).setNumberFormat('yyyy-mm-dd hh:mm');
  // Format ID cells as text so Sheets doesn't drop leading zeros or convert
  // to scientific notation.
  sh.getRange(targetRow, 8, 1, 2).setNumberFormat('@');
}

/**
 * עזרה למיגרציה: סורק את טאבי החנויות הקיימים ומאכלס את daily-flat
 * בלי לגעת ב-API. שימושי פעם אחת אחרי שמוסיפים את הטאב.
 */
function backfillFlatFromStoreTabs() {
  const ss = ensureSpreadsheet();
  let written = 0;
  for (const store of STORES) {
    const sh = ss.getSheetByName(store.name);
    if (!sh) continue;
    const layout = getLayout_(store.name);
    const lastRow = sh.getLastRow();
    if (lastRow === 0) continue;
    const all = sh.getRange(1, 1, lastRow, layout.cols).getValues();
    for (let i = 0; i < all.length; i++) {
      const v = all[i][0];
      if (!isDayRowValue_(v)) continue;
      const dateStr = v instanceof Date
        ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd')
        : v;
      const row = all[i];
      let fbCad = 0, gaCad = 0, revCad = 0;
      if (layout.type === 'split') {
        fbCad = parseFloat(row[layout.fbCol - 1]) || 0;
        gaCad = parseFloat(row[layout.gaCol - 1]) || 0;
        revCad = parseFloat(row[layout.revenueCol - 1]) || 0;
      } else if (layout.type === 'unified') {
        fbCad = parseFloat(row[layout.totalCol - 1]) || 0;
        gaCad = 0;
        revCad = parseFloat(row[layout.revenueCol - 1]) || 0;
      }
      if (fbCad === 0 && gaCad === 0 && revCad === 0) continue;
      writeDailyFlatRow_(ss, dateStr, store.id, store.name, fbCad, gaCad, revCad);
      written++;
    }
  }
  Logger.log(`Backfilled ${written} rows into daily-flat from existing store tabs`);
}

// ============================================================================
// Products-daily tab - one row per (date, store, product). LTR, hidden by default.
// ============================================================================

// New columns (Orders, Net Revenue) are appended at the END to preserve the
// position of older fields. Old rows simply have empty values in the new cols
// and the dashboard treats those as "data not available".
const PRODUCTS_DAILY_HEADERS = [
  'Date', 'Store ID', 'Store', 'Product ID', 'Product Title',
  'Units', 'Gross Revenue (CAD)', 'Orders', 'Net Revenue (CAD)'
];

function ensureProductsDailyTab_(ss) {
  let sh = ss.getSheetByName(PRODUCTS_DAILY_TAB);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(PRODUCTS_DAILY_TAB);
    sh.setRightToLeft(false);
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, PRODUCTS_DAILY_HEADERS.length)
      .setValues([PRODUCTS_DAILY_HEADERS])
      .setFontWeight('bold')
      .setBackground('#1c4587')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 95);   // Date
    sh.setColumnWidth(2, 90);   // Store ID
    sh.setColumnWidth(3, 110);  // Store Name
    sh.setColumnWidth(4, 130);  // Product ID
    sh.setColumnWidth(5, 280);  // Product Title
    sh.setColumnWidth(6, 70);   // Units
    sh.setColumnWidth(7, 130);  // Gross Revenue
    sh.setColumnWidth(8, 70);   // Orders
    sh.setColumnWidth(9, 130);  // Net Revenue
  }
  if (justCreated) {
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * Writes product-sales rows for a single (store, date) into the shared
 * `products-daily` tab. The tab is shared across all 3 stores -
 * Phase 5 per-store triggers can overlap on slow API days, so we
 * serialize writes with a script-wide LockService to prevent the
 * read-clear-write sequence from racing.
 *
 * Fix for CODEX-NEW-P0-02.
 */
function writeProductSalesForDay_(ss, dateStr, storeId, storeName, productRows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    const sh = ensureProductsDailyTab_(ss);
    const lastRow = sh.getLastRow();

    let keptRows = [];
    if (lastRow > 1) {
      const allExisting = sh.getRange(2, 1, lastRow - 1, PRODUCTS_DAILY_HEADERS.length).getValues();
      keptRows = allExisting.filter(r => {
        const v = r[0];
        const s = r[1];
        let key = null;
        if (v instanceof Date && !isNaN(v.getTime())) {
          key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
        } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          key = v;
        }
        // Keep rows that are EITHER a different date OR a different store on this date
        return !(key === dateStr && String(s) === storeId) && key !== null;
      });
    }

    const newRowsArr = (productRows || []).map(p => [
      parseYMD_(dateStr),
      storeId,
      storeName,
      p.productId || '',
      p.productTitle || '',
      parseInt(p.units || 0, 10),
      round2_(p.revenueCad || 0),
      parseInt(p.orders || 0, 10),
      round2_(p.netRevenueCad || 0),
    ]);

    const combined = keptRows.concat(newRowsArr);

    if (lastRow > 1) {
      sh.getRange(2, 1, lastRow - 1, PRODUCTS_DAILY_HEADERS.length).clearContent();
    }
    if (combined.length === 0) return;

    sh.getRange(2, 1, combined.length, PRODUCTS_DAILY_HEADERS.length).setValues(combined);
    sh.getRange(2, 1, combined.length, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
    // Force text on Product ID (col 4) so 13-19 digit Shopify IDs aren't
    // silently rounded to JS-Number precision (16 digits). Without this,
    // a 17+ digit ID written as a numeric string gets stored as a Number,
    // loses trailing digits, and never matches the productMap on the
    // dashboard side. Mirrors the existing @-format we apply to UTM IDs
    // and the line-items JSON column on orders-attribution.
    sh.getRange(2, 4, combined.length, 1).setNumberFormat('@');                                         // Product ID
    sh.getRange(2, 6, combined.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('center');   // Units
    sh.getRange(2, 7, combined.length, 1).setNumberFormat('#,##0.00');                                  // Gross Revenue
    sh.getRange(2, 8, combined.length, 1).setNumberFormat('#,##0').setHorizontalAlignment('center');   // Orders
    sh.getRange(2, 9, combined.length, 1).setNumberFormat('#,##0.00');                                  // Net Revenue
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// טאבי מודעות (ads) - drill-down נוסף מתחת ל-ad-sets. שורה לכל
// (תאריך, חנות, קמפיין, ad-set, מודעה).
// ============================================================================

const ADS_HEADERS = [
  'תאריך', 'פלטפורמה',
  'מזהה קמפיין', 'שם קמפיין',
  'מזהה אד-סט', 'שם אד-סט',
  'מזהה מודעה', 'שם מודעה',
  'יצא (CAD)', 'חשיפות', 'קליקים',
  'המרות', 'ערך המרות (CAD)', 'ROAS'
];

function ensureAdsTabHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ADS_HEADERS.length)
      .setValues([ADS_HEADERS])
      .setFontWeight('bold')
      .setBackground('#d9d9d9')
      .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 95);    // Date
    sheet.setColumnWidth(2, 80);    // Platform
    sheet.setColumnWidth(3, 120);   // Campaign ID
    sheet.setColumnWidth(4, 220);   // Campaign Name
    sheet.setColumnWidth(5, 120);   // Ad Set ID
    sheet.setColumnWidth(6, 220);   // Ad Set Name
    sheet.setColumnWidth(7, 120);   // Ad ID
    sheet.setColumnWidth(8, 260);   // Ad Name
    sheet.setColumnWidth(9, 100);   // Spend
    sheet.setColumnWidth(10, 90);   // Impressions
    sheet.setColumnWidth(11, 70);   // Clicks
    sheet.setColumnWidth(12, 70);   // Conversions
    sheet.setColumnWidth(13, 110);  // Conv Value
    sheet.setColumnWidth(14, 70);   // ROAS
  }
}

/**
 * כותב שורות מודעה לטאב הads של חנות ליום נתון.
 * Idempotent — שורות קיימות לאותו תאריך נדרסות.
 */
function writeAdsRowsForDay(ss, storeId, dateStr, rows) {
  const tabName = adsTabName_(storeId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.setRightToLeft(true);
    try { sh.hideSheet(); } catch (_) {}
  }
  ensureAdsTabHeaders_(sh);

  const lastRow = sh.getLastRow();
  let keptRows = [];
  if (lastRow > 1) {
    const allExisting = sh.getRange(2, 1, lastRow - 1, ADS_HEADERS.length).getValues();
    keptRows = allExisting.filter(r => {
      const v = r[0];
      let key = null;
      if (v instanceof Date && !isNaN(v.getTime())) {
        key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        key = v;
      }
      // Preserve rows with unparseable dates — see writeCampaignRowsForDay
      // for the rationale (avoid silently destroying mid-format crash victims).
      return key !== dateStr;
    });
  }

  const newRowsArr = (rows || []).map(r => [
    parseYMD_(r.date),
    r.platform,
    r.campaignId || '',
    r.campaignName || '',
    r.adSetId || '',
    r.adSetName || '',
    r.adId || '',
    r.adName || '',
    round2_(r.spendCad || 0),
    parseInt(r.impressions || 0, 10),
    parseInt(r.clicks || 0, 10),
    round2_(r.conversions || 0),
    round2_(r.conversionValueCad || 0),
    '', // ROAS - formula
  ]);

  const combined = keptRows.concat(newRowsArr);

  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, ADS_HEADERS.length).clearContent();
  }
  if (combined.length === 0) return;

  // Force long platform IDs to text before writing. Meta IDs can exceed JS
  // number precision if Sheets auto-parses them as numeric cells.
  sh.getRange(2, 3, combined.length, 1).setNumberFormat('@'); // Campaign ID
  sh.getRange(2, 5, combined.length, 1).setNumberFormat('@'); // Ad Set ID
  sh.getRange(2, 7, combined.length, 1).setNumberFormat('@'); // Ad ID
  sh.getRange(2, 1, combined.length, ADS_HEADERS.length).setValues(combined);
  sh.getRange(2, 1, combined.length, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
  sh.getRange(2, 9, combined.length, 1).setNumberFormat('#,##0.00');                   // Spend
  sh.getRange(2, 10, combined.length, 2).setNumberFormat('#,##0');                      // Impressions, Clicks
  sh.getRange(2, 12, combined.length, 2).setNumberFormat('#,##0.00');                   // Conversions, Conv Value
  sh.getRange(2, 14, combined.length, 1).setNumberFormat('0.00').setHorizontalAlignment('center');

  const formulas = combined.map((_, i) => {
    const r = 2 + i;
    return [`=IFERROR(M${r}/I${r}, "")`]; // ROAS = ConvValue (M) / Spend (I)
  });
  sh.getRange(2, 14, combined.length, 1).setFormulas(formulas);
}

// ============================================================================
// טאב product-catalog לכל חנות. שורה לכל מוצר פעיל מה-Shopify Admin API.
// משמש את ה-ProductPickerModal בדשבורד כדי לאפשר שיוך גם למוצרים חדשים שעוד
// לא ביצעו אפילו הזמנה אחת (products-daily מכיל רק נמכרים).
// ============================================================================

const PRODUCT_CATALOG_HEADERS = [
  'Product ID', 'Title', 'Handle', 'Status', 'Price (CAD)',
  'Image URL', 'Product Type', 'Vendor', 'Updated At'
];

function productCatalogTabName_(storeId) {
  return `${storeId}-products-catalog`;
}

function ensureProductCatalogTab_(ss, storeId) {
  const tabName = productCatalogTabName_(storeId);
  let sh = ss.getSheetByName(tabName);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.setRightToLeft(false);
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, PRODUCT_CATALOG_HEADERS.length)
      .setValues([PRODUCT_CATALOG_HEADERS])
      .setFontWeight('bold')
      .setBackground('#1c4587')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 130);  // Product ID
    sh.setColumnWidth(2, 280);  // Title
    sh.setColumnWidth(3, 160);  // Handle
    sh.setColumnWidth(4, 80);   // Status
    sh.setColumnWidth(5, 100);  // Price
    sh.setColumnWidth(6, 240);  // Image URL
    sh.setColumnWidth(7, 120);  // Product Type
    sh.setColumnWidth(8, 120);  // Vendor
    sh.setColumnWidth(9, 140);  // Updated At
  }
  if (justCreated) {
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * Replace-mode write — catalogs are small and the source-of-truth is
 * Shopify itself. Idempotent: clear-then-write each refresh so deleted
 * products don't linger in the sheet.
 */
function writeProductCatalogForStore_(ss, storeId, products) {
  const sh = ensureProductCatalogTab_(ss, storeId);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, PRODUCT_CATALOG_HEADERS.length).clearContent();
  }
  if (!products || products.length === 0) return;
  const updatedAt = new Date();
  const rows = products.map(p => [
    p.productId,
    p.title,
    p.handle,
    p.status,
    p.priceCad,
    p.imageUrl,
    p.productType,
    p.vendor,
    updatedAt,
  ]);
  sh.getRange(2, 1, rows.length, PRODUCT_CATALOG_HEADERS.length).setValues(rows);
  // Force text on Product ID (col 1) so long Shopify IDs survive the
  // Sheets-Number roundtrip. The picker stores these IDs in the
  // productMap and matches them against products-daily.productId; if
  // either side loses precision, mapping breaks silently.
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');                      // Product ID
  sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.00');               // Price
  sh.getRange(2, 9, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');       // Updated At
}

/**
 * Returns true when the product-catalog tab for a store is missing,
 * empty, or its newest "Updated At" cell is older than `maxAgeDays`.
 * Caller uses this to skip the heavy daily refresh when the catalog is
 * still fresh, avoiding Sheets API quota pressure when combined with the
 * campaigns + ads writes.
 */
function catalogNeedsRefresh_(ss, storeId, maxAgeDays) {
  const sh = ss.getSheetByName(productCatalogTabName_(storeId));
  if (!sh) return true;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return true; // header only or empty
  // Column 9 = "Updated At". Sample the first data row (we always
  // overwrite all rows at the same time so all timestamps match).
  const lastUpdate = sh.getRange(2, 9).getValue();
  if (!(lastUpdate instanceof Date) || isNaN(lastUpdate.getTime())) return true;
  const ageMs = Date.now() - lastUpdate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

/**
 * Manual full refresh of product catalogs for all stores. Useful after a
 * launch: run this once to force a fresh fetch instead of waiting for the
 * 7-day cache to expire naturally.
 *
 * Resilience built in:
 *  - Each store wrapped in its own try/catch so one failure doesn't cascade.
 *  - 1-second sleep between stores to spread out Sheets API quota usage —
 *    the actual reason the previous daily-run path timed out (campaigns +
 *    ads + catalog all hitting the API in tight succession exceeded the
 *    short-window quota).
 *  - Per-store retry on transient Sheets timeout: write is repeated once
 *    after a 3-second pause before declaring failure for that store.
 *  - Catalog is written in chunks of 100 rows when the catalog is large,
 *    further reducing the chance of a single setValues call timing out.
 */
function refreshAllProductCatalogs() {
  const ss = ensureSpreadsheet();
  for (let i = 0; i < STORES.length; i++) {
    const store = STORES[i];
    if (i > 0) Utilities.sleep(1000); // breathe between stores
    let attempt = 0;
    while (attempt < 2) {
      attempt++;
      try {
        const catalog = getShopifyProductsCatalog(store.id);
        writeProductCatalogForStoreChunked_(ss, store.id, catalog);
        Logger.log(`Catalog refreshed for ${store.name}: ${catalog.length} products (attempt ${attempt})`);
        break;
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const transient = /timed out|timeout|rate limit|Internal error|backend|temporarily|try again/i.test(msg);
        if (transient && attempt < 2) {
          Logger.log(`Catalog ${store.name} attempt ${attempt} transient: ${msg}. Retrying in 3s...`);
          Utilities.sleep(3000);
          continue;
        }
        Logger.log(`Catalog refresh ${store.name} failed (final): ${msg}`);
        break;
      }
    }
  }
}

/**
 * Like writeProductCatalogForStore_ but writes in chunks of 100 rows.
 * A single setValues call of 500+ rows × 9 cols was the bottleneck in the
 * timeout. Chunking keeps each Sheets API call modest and lets the script
 * yield between them. Number formats are applied once at the end across
 * the full data range — that operation is fast even on the largest catalog.
 */
function writeProductCatalogForStoreChunked_(ss, storeId, products) {
  const sh = ensureProductCatalogTab_(ss, storeId);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, PRODUCT_CATALOG_HEADERS.length).clearContent();
  }
  if (!products || products.length === 0) return;

  // Stage 1: write all rows with the Updated At column LEFT EMPTY. This
  // matters for the catalogNeedsRefresh_ cache gate (#WR-01): if a chunk
  // fails partway, the partial sheet has NO timestamp on any row, so the
  // gate at SheetBuilder.gs:1351 sees an empty col-9 value, fails the
  // `instanceof Date` check, returns true, and the next run re-fetches.
  // Previously we wrote `updatedAt` on every chunked row, which meant a
  // partial write left a fresh timestamp on rows 2..101 and the gate
  // mistakenly skipped the refresh for up to 7 days.
  const rows = products.map(p => [
    p.productId, p.title, p.handle, p.status, p.priceCad,
    p.imageUrl, p.productType, p.vendor, '', // <- empty timestamp during chunked write
  ]);

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    sh.getRange(2 + i, 1, slice.length, PRODUCT_CATALOG_HEADERS.length).setValues(slice);
  }

  // Stage 2: ONLY after every chunk succeeded, stamp Updated At across the
  // whole data range in one batch write. If any earlier chunk threw, we
  // never reach this line, and the sheet stays in a "fresh data, no
  // timestamp" state that catalogNeedsRefresh_ correctly treats as stale.
  const updatedAt = new Date();
  const stamps = rows.map(() => [updatedAt]);
  sh.getRange(2, 9, rows.length, 1).setValues(stamps);

  sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 9, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
}

// ============================================================================
// טאב {storeId}-orders-attribution. שורה לכל הזמנה ב-Shopify עם classification
// של מקור הטראפיק (meta-paid / google-paid / direct / organic / etc.) מ-UTM,
// fbclid, gclid, ו-referring_site. זה מאפשר לדשבורד לדעת *באמת* כמה הזמנות
// הגיעו מקליקים על מודעות Meta — לא רק להאמין למה ש-Meta מדווח.
// ============================================================================

// Cols 1..11 are the original schema; 12-13 added when Meta's URL Parameters
// were extended with utm_id={{campaign.id}} + utm_term={{adset.id}}. These
// give us ID-based matching (strictly stronger than utm_campaign by name)
// because IDs are immutable across renames.
// Col 14 (Phase 1) carries per-order line items as compact JSON
// (`[{"p":productId,"u":units,"r":revenueCad}, ...]`) so the dashboard can
// answer channel-level questions about mapped products independent of
// utm_id matching. See computeLineItemsCad_ in Shopify.gs.
const ORDERS_ATTRIBUTION_HEADERS = [
  'תאריך', 'מזהה הזמנה', 'סכום (CAD)', 'מקור',
  'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content',
  'fbclid', 'gclid', 'Referrer',
  'UTM ID', 'UTM Term',
  'Line Items (JSON)'
];

function ensureOrdersAttributionTab_(ss, storeId) {
  const tabName = ordersAttributionTabName_(storeId);
  let sh = ss.getSheetByName(tabName);
  let justCreated = false;
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.setRightToLeft(true);
    justCreated = true;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, ORDERS_ATTRIBUTION_HEADERS.length)
      .setValues([ORDERS_ATTRIBUTION_HEADERS])
      .setFontWeight('bold')
      .setBackground('#d9d9d9')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 95);   // Date
    sh.setColumnWidth(2, 130);  // Order ID
    sh.setColumnWidth(3, 90);   // Total
    sh.setColumnWidth(4, 110);  // Source
    sh.setColumnWidth(5, 110);  // UTM Source
    sh.setColumnWidth(6, 110);  // UTM Medium
    sh.setColumnWidth(7, 200);  // UTM Campaign
    sh.setColumnWidth(8, 140);  // UTM Content
    sh.setColumnWidth(9, 60);   // fbclid
    sh.setColumnWidth(10, 60);  // gclid
    sh.setColumnWidth(11, 200); // Referrer
    sh.setColumnWidth(12, 150); // UTM ID
    sh.setColumnWidth(13, 150); // UTM Term
    sh.setColumnWidth(14, 320); // Line Items (JSON) — wider, JSON cells are long
  } else {
    // Idempotent migration: existing tabs created before the utm_id /
    // utm_term columns get the new headers added without losing data.
    const lastCol = sh.getLastColumn();
    if (lastCol < 13) {
      const labels = ['UTM ID', 'UTM Term'];
      for (let i = 0; i < 2; i++) {
        const col = 12 + i;
        const cell = sh.getRange(1, col);
        if (!cell.getValue()) {
          cell.setValue(labels[i])
            .setFontWeight('bold')
            .setBackground('#d9d9d9')
            .setHorizontalAlignment('center');
        }
      }
      sh.setColumnWidth(12, 150);
      sh.setColumnWidth(13, 150);
    }
    // Phase 1 migration: add col 14 = Line Items (JSON). Append (NOT
    // replace) the existing lastCol<13 block — a tab that's been completely
    // untouched needs BOTH migrations applied, so they coexist via
    // independent defensive checks.
    if (lastCol < 14) {
      const cell = sh.getRange(1, 14);
      if (!cell.getValue()) {
        cell.setValue('Line Items (JSON)')
          .setFontWeight('bold')
          .setBackground('#d9d9d9')
          .setHorizontalAlignment('center');
      }
      sh.setColumnWidth(14, 320);
    }
  }
  if (justCreated) {
    try { sh.hideSheet(); } catch (_) {}
  }
  return sh;
}

/**
 * Idempotent write — rows for `dateStr` are replaced; rows for other days
 * stay. Same shape as writeCampaignRowsForDay (filter-kept + concat + clear
 * + single setValues).
 */
function writeOrdersAttributionForDay(ss, storeId, dateStr, rows) {
  const sh = ensureOrdersAttributionTab_(ss, storeId);
  const lastRow = sh.getLastRow();
  let keptRows = [];
  if (lastRow > 1) {
    const allExisting = sh.getRange(2, 1, lastRow - 1, ORDERS_ATTRIBUTION_HEADERS.length).getValues();
    keptRows = allExisting.filter(r => {
      const v = r[0];
      let key = null;
      if (v instanceof Date && !isNaN(v.getTime())) {
        key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        key = v;
      }
      // Preserve rows with unparseable dates — see writeCampaignRowsForDay
      // for the rationale (avoid silently destroying mid-format crash victims).
      return key !== dateStr;
    });
  }

  const newRowsArr = (rows || []).map(r => [
    parseYMD_(dateStr),
    r.orderId,
    round2_(r.totalCad || 0),
    r.source || '',
    r.utmSource || '',
    r.utmMedium || '',
    r.utmCampaign || '',
    r.utmContent || '',
    r.fbclidPresent ? 'TRUE' : '',
    r.gclidPresent ? 'TRUE' : '',
    r.referringSite || '',
    r.utmId || '',
    r.utmTerm || '',
    // Phase 1 col N: JSON.stringify on `[]` gives '[]' which is more
    // self-documenting than '' and both decode to [] in the dashboard
    // parser. Always 14 cells per row regardless of line-item content
    // (Pitfall 5 — Sheets `setValues` is strict about rectangle width).
    JSON.stringify(r.lineItems || []),
  ]);

  const combined = keptRows.concat(newRowsArr);

  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, ORDERS_ATTRIBUTION_HEADERS.length).clearContent();
  }
  if (combined.length === 0) return;

  // Force the ID columns (B, L, M) to text format BEFORE writing so Sheets
  // doesn't convert long numeric IDs to scientific notation. Meta IDs are
  // 17-19 digits — outside double precision representation as a number.
  sh.getRange(2, 2, combined.length, 1).setNumberFormat('@');   // Order ID
  sh.getRange(2, 12, combined.length, 2).setNumberFormat('@');  // UTM ID + UTM Term
  // Phase 1: col N carries JSON strings. Force text format so Sheets
  // doesn't try to interpret '[{...}]' as some other type and corrupt the
  // payload on round-trip.
  sh.getRange(2, 14, combined.length, 1).setNumberFormat('@');  // Line Items (JSON)

  sh.getRange(2, 1, combined.length, ORDERS_ATTRIBUTION_HEADERS.length).setValues(combined);
  sh.getRange(2, 1, combined.length, 1).setNumberFormat('yyyy-mm-dd').setHorizontalAlignment('center');
  sh.getRange(2, 3, combined.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 9, combined.length, 2).setHorizontalAlignment('center');
}

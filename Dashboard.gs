/**
 * Dashboard.gs - דשבורד אינטראקטיבי בתוך הגיליון.
 *
 * מבנה:
 *   טאב "Dashboard" - מוצג למשתמש
 *     - כותרת
 *     - בורר תאריכים (מאז / עד) + בורר חנות (All / שם חנות)
 *     - 4 KPI cards: ROAS ממוצע, סך הכנסות, סך הוצאות, רווח גולמי
 *     - 2 גרפים: מגמת ROAS לאורך זמן + השוואה בין חנויות
 *     - טבלה יומית מסוננת
 *
 *   טאב מוסתר "_dashboard-helpers" - נתונים מבוסי PIVOT לגרפים.
 */

const DASHBOARD_TAB = 'Dashboard';
const DASHBOARD_HELPERS_TAB = '_dashboard-helpers';

const DASHBOARD_COLORS = {
  titleBg: '#1c4587',
  titleFg: '#ffffff',
  kpiLabelBg: '#cccccc',
  kpiValueBg: '#f3f3f3',
  sectionTitle: '#434343',
  headerBg: '#d9d9d9',
};

/**
 * נקודת הכניסה הראשית - בונה (או בונה מחדש) את הדשבורד.
 */
function setupDashboard() {
  const ss = ensureSpreadsheet();
  buildHelpersTab_(ss);
  buildDashboardTab_(ss);
  Logger.log('Dashboard ready: ' + ss.getUrl() + '#gid=' + ss.getSheetByName(DASHBOARD_TAB).getSheetId());
}

// ============================================================================
// טאב Helpers - נתונים pivoted לגרפים
// ============================================================================

function buildHelpersTab_(ss) {
  let sh = ss.getSheetByName(DASHBOARD_HELPERS_TAB);
  if (!sh) {
    sh = ss.insertSheet(DASHBOARD_HELPERS_TAB);
  }
  sh.clear();
  sh.setRightToLeft(false);
  sh.setHiddenGridlines(true);

  // אזור 1: ROAS לפי תאריך וחנות (pivot)
  sh.getRange('A1').setValue('ROAS by Date x Store')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange('A3').setFormula(
    `=IFERROR(QUERY('${DAILY_FLAT_TAB}'!A:I, ` +
    `"SELECT A, AVG(H) WHERE A is not null GROUP BY A PIVOT C ORDER BY A LABEL AVG(H) ''", 1), ` +
    `"No data")`
  );

  // אזור 2: סיכומים לחנות (לגרף עמודות)
  sh.getRange('M1').setValue('Aggregates by Store')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange('M3').setFormula(
    `=IFERROR(QUERY('${DAILY_FLAT_TAB}'!A:I, ` +
    `"SELECT C, SUM(G), SUM(F), AVG(H) WHERE A is not null ` +
    `GROUP BY C LABEL SUM(G) 'Revenue', SUM(F) 'Spend', AVG(H) 'Avg ROAS'", 1), ` +
    `"No data")`
  );

  // אזור 3: סיכום יומי כללי (לגרף סה"כ ROAS)
  sh.getRange('S1').setValue('Daily Totals (all stores)')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange('S3').setFormula(
    `=IFERROR(QUERY('${DAILY_FLAT_TAB}'!A:I, ` +
    `"SELECT A, SUM(G), SUM(F), SUM(G)/SUM(F) WHERE A is not null ` +
    `GROUP BY A ORDER BY A LABEL SUM(G) 'Revenue', SUM(F) 'Spend', SUM(G)/SUM(F) 'ROAS'", 1), ` +
    `"No data")`
  );

  // הסתר את הטאב
  try { sh.hideSheet(); } catch (_) {}
}

// ============================================================================
// טאב הדשבורד הראשי
// ============================================================================

function buildDashboardTab_(ss) {
  let sh = ss.getSheetByName(DASHBOARD_TAB);
  if (sh) {
    // נקה תוכן וגרפים
    sh.clear();
    sh.clearConditionalFormatRules();
    const charts = sh.getCharts();
    for (const c of charts) sh.removeChart(c);
  } else {
    sh = ss.insertSheet(DASHBOARD_TAB);
  }
  sh.setRightToLeft(true);
  sh.setHiddenGridlines(true);

  // מקם את הדשבורד אחרי הסיכום
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(2);

  // עיצוב רוחב עמודות
  for (let c = 1; c <= 13; c++) {
    sh.setColumnWidth(c, 95);
  }

  buildDashboardHeader_(sh);
  buildDashboardFilters_(sh);
  buildDashboardKpis_(sh);
  buildDashboardCharts_(sh, ss);
  buildDashboardTable_(sh);
}

function buildDashboardHeader_(sh) {
  sh.getRange('A1:M1').merge()
    .setValue('דשבורד ROAS — מעקב יומי לכל החנויות')
    .setFontSize(20)
    .setFontWeight('bold')
    .setBackground(DASHBOARD_COLORS.titleBg)
    .setFontColor(DASHBOARD_COLORS.titleFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 50);
  sh.setRowHeight(2, 15);
}

function buildDashboardFilters_(sh) {
  // ברירות מחדל: תחילת החודש הנוכחי עד היום
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstStr = Utilities.formatDate(firstOfMonth, TZ, 'yyyy-MM-dd');
  const todayStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');

  sh.getRange('A3').setValue('מתאריך:').setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('B3').setValue(firstStr)
    .setNumberFormat('yyyy-mm-dd')
    .setBackground('#fff2cc')
    .setHorizontalAlignment('center');

  sh.getRange('C3').setValue('עד תאריך:').setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('D3').setValue(todayStr)
    .setNumberFormat('yyyy-mm-dd')
    .setBackground('#fff2cc')
    .setHorizontalAlignment('center');

  sh.getRange('E3').setValue('חנות:').setFontWeight('bold').setHorizontalAlignment('left');
  const storeOptions = ['All', ...STORES.map(s => s.name)];
  const storeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(storeOptions, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange('F3').setDataValidation(storeRule).setValue('All')
    .setBackground('#fff2cc')
    .setHorizontalAlignment('center');

  // אזור הסבר קטן
  sh.getRange('H3:M3').merge()
    .setValue('💡 שנה את התאריכים והחנות כדי לסנן — הכל מתעדכן אוטומטית')
    .setFontStyle('italic')
    .setFontColor('#666666')
    .setHorizontalAlignment('right');

  sh.setRowHeight(3, 30);
  sh.setRowHeight(4, 15);
}

function buildDashboardKpis_(sh) {
  const flatRef = `'${DAILY_FLAT_TAB}'`;

  // בנה את הקריטריון לתנאי "חנות = ?" (תומך ב-All)
  const storeCriteriaFor = function(col) {
    return `${flatRef}!${col}:${col}, IF($F$3="All", "*", $F$3)`;
  };

  const dateCriteria =
    `${flatRef}!A:A, ">="&$B$3, ` +
    `${flatRef}!A:A, "<="&$D$3, `;

  const kpis = [
    {
      labelRange: 'A5:C5',
      valueRange: 'A6:C6',
      label: 'ROAS ממוצע',
      formula: `=IFERROR(AVERAGEIFS(${flatRef}!H:H, ${dateCriteria}${storeCriteriaFor('C')}), 0)`,
      format: '0.00',
    },
    {
      labelRange: 'D5:F5',
      valueRange: 'D6:F6',
      label: 'סך הכנסות (CAD)',
      formula: `=IFERROR(SUMIFS(${flatRef}!G:G, ${dateCriteria}${storeCriteriaFor('C')}), 0)`,
      format: '"CAD"#,##0',
    },
    {
      labelRange: 'G5:I5',
      valueRange: 'G6:I6',
      label: 'סך הוצאות (CAD)',
      formula: `=IFERROR(SUMIFS(${flatRef}!F:F, ${dateCriteria}${storeCriteriaFor('C')}), 0)`,
      format: '"CAD"#,##0',
    },
    {
      labelRange: 'J5:M5',
      valueRange: 'J6:M6',
      label: 'רווח גולמי (CAD)',
      formula: `=IFERROR(SUMIFS(${flatRef}!I:I, ${dateCriteria}${storeCriteriaFor('C')}), 0)`,
      format: '"CAD"#,##0',
    },
  ];

  for (const k of kpis) {
    sh.getRange(k.labelRange).merge()
      .setValue(k.label)
      .setFontWeight('bold')
      .setFontSize(11)
      .setBackground(DASHBOARD_COLORS.kpiLabelBg)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sh.getRange(k.valueRange).merge()
      .setFormula(k.formula)
      .setNumberFormat(k.format)
      .setFontWeight('bold')
      .setFontSize(22)
      .setBackground(DASHBOARD_COLORS.kpiValueBg)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }

  sh.setRowHeight(5, 28);
  sh.setRowHeight(6, 55);
  sh.setRowHeight(7, 15);

  // צביעת ROAS card לפי הערך
  const roasCardRange = sh.getRange('A6');
  const existingRules = sh.getConditionalFormatRules();
  const newRules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(2).setBackground(ROAS_COLORS.red).setRanges([roasCardRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2, 2.6999).setBackground(ROAS_COLORS.orange).setRanges([roasCardRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2.7, 3).setBackground(ROAS_COLORS.green).setRanges([roasCardRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(3).setBackground(ROAS_COLORS.blue).setRanges([roasCardRange]).build(),
  ];
  sh.setConditionalFormatRules([...existingRules, ...newRules]);
}

function buildDashboardCharts_(sh, ss) {
  const helpers = ss.getSheetByName(DASHBOARD_HELPERS_TAB);
  if (!helpers) return;

  // כותרת קטע
  sh.getRange('A8:M8').merge()
    .setValue('מגמת ROAS לאורך זמן (לפי חנות)')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DASHBOARD_COLORS.sectionTitle)
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  // גרף קו - ROAS לאורך זמן (משתמש בpivot מ-helpers!A3:L500)
  const lineChart = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(helpers.getRange('A3:L500'))
    .setPosition(9, 1, 0, 0)
    .setOption('title', '')
    .setOption('legend', { position: 'top', alignment: 'center' })
    .setOption('hAxis', { title: 'תאריך', format: 'yyyy-MM-dd' })
    .setOption('vAxis', { title: 'ROAS', minValue: 0 })
    .setOption('width', 1200)
    .setOption('height', 340)
    .setOption('curveType', 'function')
    .setOption('pointSize', 4)
    .setOption('lineWidth', 2)
    .build();
  sh.insertChart(lineChart);

  // כותרת לגרף שני (אחרי הראשון)
  sh.getRange('A28:M28').merge()
    .setValue('השוואה בין חנויות — הכנסות, הוצאות, ROAS')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DASHBOARD_COLORS.sectionTitle)
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  // גרף שילובי: עמודות הכנסות/הוצאות + קו ROAS
  const comboChart = sh.newChart()
    .setChartType(Charts.ChartType.COMBO)
    .addRange(helpers.getRange('M3:P500'))
    .setPosition(29, 1, 0, 0)
    .setOption('title', '')
    .setOption('legend', { position: 'top', alignment: 'center' })
    .setOption('hAxis', { title: 'חנות' })
    .setOption('series', {
      0: { type: 'bars', targetAxisIndex: 0 },
      1: { type: 'bars', targetAxisIndex: 0 },
      2: { type: 'line', targetAxisIndex: 1, lineWidth: 3, pointSize: 6 },
    })
    .setOption('vAxes', {
      0: { title: 'CAD' },
      1: { title: 'ROAS', minValue: 0 },
    })
    .setOption('width', 1200)
    .setOption('height', 340)
    .build();
  sh.insertChart(comboChart);
}

function buildDashboardTable_(sh) {
  const flatRef = `'${DAILY_FLAT_TAB}'`;

  sh.getRange('A48:M48').merge()
    .setValue('פירוט יומי — לפי הסינון שבחרת')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DASHBOARD_COLORS.sectionTitle)
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  // QUERY מסונן לפי תאריכים וחנות
  const queryFormula =
    `=IFERROR(QUERY(${flatRef}!A:I, ` +
    `"SELECT A, C, D, E, F, G, H, I ` +
    `WHERE A IS NOT NULL ` +
    `AND A >= date '"&TEXT($B$3,"yyyy-MM-dd")&"' ` +
    `AND A <= date '"&TEXT($D$3,"yyyy-MM-dd")&"' "` +
    `&IF($F$3<>"All", "AND C = '"&$F$3&"' ", "")` +
    `&"ORDER BY A DESC LIMIT 200 ` +
    `LABEL A 'תאריך', C 'חנות', D 'יצא פייסבוק', E 'יצא גוגל', F 'יצא סה""כ', ` +
    `G 'נכנס', H 'ROAS', I 'רווח גולמי' ` +
    `FORMAT A 'yyyy-mm-dd', D '#,##0.00', E '#,##0.00', F '#,##0.00', G '#,##0.00', H '0.00', I '#,##0.00'", 1), ` +
    `"אין נתונים בטווח שבחרת")`;

  sh.getRange('A50').setFormula(queryFormula);

  // עיצוב לכותרות הטבלה (השורה הראשונה של ה-QUERY)
  // כיוון שזה QUERY דינמי, נחיל עיצוב על אזור גדול
  sh.getRange('A50:M50')
    .setFontWeight('bold')
    .setBackground(DASHBOARD_COLORS.headerBg)
    .setHorizontalAlignment('center');

  // צביעת ROAS על עמודה G (העמודה השביעית, אחרי תאריך)
  const roasCol = 'G';
  const range = sh.getRange(`${roasCol}51:${roasCol}1000`);
  const existing = sh.getConditionalFormatRules();
  const newRules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(2).setBackground(ROAS_COLORS.red).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2, 2.6999).setBackground(ROAS_COLORS.orange).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2.7, 3).setBackground(ROAS_COLORS.green).setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(3).setBackground(ROAS_COLORS.blue).setRanges([range]).build(),
  ];
  sh.setConditionalFormatRules([...existing, ...newRules]);

  // הקפא שורות (1=title, 3=filter, 5-6=KPIs, 50=table header)
  sh.setFrozenRows(0); // לא נקפא כדי לאפשר גלילה רגילה
}

/**
 * Dashboard.gs - דשבורד אינטראקטיבי ידידותי למשתמש לא טכני.
 *
 * עקרונות UX:
 *   - בורר תקופה קבוע (השבוע / החודש / חודש קודם / 30 יום / מותאם)
 *   - שדות תאריך מתעדכנים אוטומטית כשמשנים את הבורר (onEdit)
 *   - 4 KPI cards עם ערך גדול, תווית מילולית ("טוב", "מעולה"), ושינוי מהתקופה הקודמת
 *   - תובנות אוטומטיות (חנות מובילה, חנות בסיכון, יום הכי טוב)
 *   - גרף מרכזי + טבלת פירוט
 */

const DASHBOARD_TAB = 'Dashboard';
const DASHBOARD_HELPERS_TAB = '_dashboard-helpers';

const PRESET_OPTIONS = [
  'השבוע',
  '7 ימים אחרונים',
  'החודש הזה',
  'חודש קודם',
  '30 ימים אחרונים',
  'מותאם אישית',
];
const DEFAULT_PRESET = 'החודש הזה';

const DBC = {
  // Color palette
  primary: '#1c4587',
  primaryFg: '#ffffff',
  sectionBg: '#434343',
  sectionFg: '#ffffff',
  filterBg: '#fff2cc',
  cardLabelBg: '#e8eaed',
  cardValueBg: '#ffffff',
  cardBorder: '#d9d9d9',
  insightBg: '#fef7e0',
  positiveBg: '#e6f4ea',
  positiveFg: '#137333',
  negativeBg: '#fce8e6',
  negativeFg: '#c5221f',
  neutralFg: '#5f6368',
};

/**
 * נקודת כניסה - בונה (או מרענן) את הדשבורד.
 */
function setupDashboard() {
  const ss = ensureSpreadsheet();
  buildHelpersTab_(ss);
  buildDashboardTab_(ss);
  Logger.log('Dashboard ready');
}

/**
 * Hook הנקרא מ-Main.gs onEdit - מעדכן תאריכים כשמשנים את הבורר.
 */
function dashboardOnEdit_(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== DASHBOARD_TAB) return;
  const cell = e.range.getA1Notation();
  if (cell !== 'B3') return; // רק לבורר התקופה

  const preset = e.value;
  if (preset === 'מותאם אישית') return; // אל תיגע ב-B4/D4

  const dates = computePresetDates_(preset);
  if (!dates) return;
  sheet.getRange('B4').setValue(parseYMD_(dates.from)).setNumberFormat('yyyy-mm-dd');
  sheet.getRange('D4').setValue(parseYMD_(dates.to)).setNumberFormat('yyyy-mm-dd');
}

function computePresetDates_(preset) {
  const now = new Date();
  const fmt = (d) => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const todayStr = fmt(now);

  switch (preset) {
    case 'השבוע': {
      // ראשון של השבוע הנוכחי (יום ראשון = 0 ב-JS)
      const day = now.getDay();
      const sunday = new Date(now.getTime() - day * 86400000);
      return { from: fmt(sunday), to: todayStr };
    }
    case '7 ימים אחרונים': {
      const past = new Date(now.getTime() - 6 * 86400000);
      return { from: fmt(past), to: todayStr };
    }
    case 'החודש הזה': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(first), to: todayStr };
    }
    case 'חודש קודם': {
      const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(firstPrev), to: fmt(lastPrev) };
    }
    case '30 ימים אחרונים': {
      const past = new Date(now.getTime() - 29 * 86400000);
      return { from: fmt(past), to: todayStr };
    }
    default:
      return null;
  }
}

// ============================================================================
// טאב Helpers - QUERY-ים שמייצרים את הנתונים לגרפים ולתובנות
// ============================================================================

function buildHelpersTab_(ss) {
  let sh = ss.getSheetByName(DASHBOARD_HELPERS_TAB);
  if (!sh) {
    sh = ss.insertSheet(DASHBOARD_HELPERS_TAB);
  }
  sh.clear();
  sh.setRightToLeft(false);
  sh.setHiddenGridlines(true);

  const flat = `'${DAILY_FLAT_TAB}'`;
  const dash = `'${DASHBOARD_TAB}'`;

  // אזור 1 (A:L): ROAS לפי תאריך וחנות (לגרף קו).
  // PIVOT C יוצר עמודה לכל חנות; הסרת LABEL מבטיחה ששמות החנויות יהיו ב-row 3 (headers).
  sh.getRange('A1').setValue('ROAS by Date x Store').setFontWeight('bold');
  sh.getRange('A3').setFormula(
    `=IFERROR(QUERY(${flat}!A:I, ` +
    `"SELECT A, AVG(H) WHERE A is not null GROUP BY A PIVOT C ORDER BY A LABEL A 'תאריך'", 1), "")`
  );

  // אזור 2 (N:Q): סיכומים לחנות בתקופה הנוכחית (לתובנות + גרפים)
  sh.getRange('N1').setValue('Store Aggregates (current period)').setFontWeight('bold');
  sh.getRange('N3').setFormula(
    `=IFERROR(QUERY(${flat}!A:I, ` +
    `"SELECT C, SUM(G), SUM(F), AVG(H) ` +
    `WHERE A >= date '"&TEXT(${dash}!$B$4,"yyyy-MM-dd")&"' ` +
    `AND A <= date '"&TEXT(${dash}!$D$4,"yyyy-MM-dd")&"' ` +
    `GROUP BY C ORDER BY AVG(H) DESC ` +
    `LABEL SUM(G) 'Revenue', SUM(F) 'Spend', AVG(H) 'ROAS'", 1), "")`
  );

  // אזור 3 (S:V): סיכום יומי כללי לתקופה (לתובנות יום הכי טוב/גרוע)
  sh.getRange('S1').setValue('Daily Totals (current period)').setFontWeight('bold');
  sh.getRange('S3').setFormula(
    `=IFERROR(QUERY(${flat}!A:I, ` +
    `"SELECT A, SUM(G), SUM(F), SUM(G)/SUM(F) ` +
    `WHERE A >= date '"&TEXT(${dash}!$B$4,"yyyy-MM-dd")&"' ` +
    `AND A <= date '"&TEXT(${dash}!$D$4,"yyyy-MM-dd")&"' ` +
    `GROUP BY A ORDER BY SUM(G)/SUM(F) DESC ` +
    `LABEL SUM(G) 'Revenue', SUM(F) 'Spend', SUM(G)/SUM(F) 'ROAS'", 1), "")`
  );

  try { sh.hideSheet(); } catch (_) {}
}

// ============================================================================
// טאב הדשבורד הראשי
// ============================================================================

function buildDashboardTab_(ss) {
  let sh = ss.getSheetByName(DASHBOARD_TAB);
  if (sh) {
    sh.clear();
    sh.clearConditionalFormatRules();
    const charts = sh.getCharts();
    for (const c of charts) sh.removeChart(c);
  } else {
    sh = ss.insertSheet(DASHBOARD_TAB);
  }
  sh.setRightToLeft(true);
  sh.setHiddenGridlines(true);

  // הצב את הדשבורד מיד אחרי הסיכום
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(2);

  // רוחב עמודות אחיד
  for (let c = 1; c <= 13; c++) sh.setColumnWidth(c, 100);

  buildHeader_(sh);
  buildFilters_(sh);
  buildKpis_(sh);
  buildInsights_(sh);
  buildChart_(sh, ss);
  buildTable_(sh);
}

function buildHeader_(sh) {
  sh.getRange('A1:M1').merge()
    .setValue('דשבורד ROAS  •  מעקב יומי')
    .setFontSize(22)
    .setFontWeight('bold')
    .setBackground(DBC.primary)
    .setFontColor(DBC.primaryFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 55);
  sh.setRowHeight(2, 12);
}

function buildFilters_(sh) {
  // שורה 3 - בורר תקופה ובורר חנות
  sh.getRange('A3').setValue('📅 תקופה:').setFontWeight('bold').setHorizontalAlignment('left').setVerticalAlignment('middle');

  const presetRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRESET_OPTIONS, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange('B3:C3').merge()
    .setValue(DEFAULT_PRESET)
    .setDataValidation(presetRule)
    .setBackground(DBC.filterBg)
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sh.getRange('E3').setValue('🏪 חנות:').setFontWeight('bold').setHorizontalAlignment('left').setVerticalAlignment('middle');

  const storeOptions = ['All', ...STORES.map(s => s.name)];
  const storeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(storeOptions, true)
    .setAllowInvalid(false)
    .build();
  sh.getRange('F3:G3').merge()
    .setValue('All')
    .setDataValidation(storeRule)
    .setBackground(DBC.filterBg)
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sh.getRange('I3:M3').merge()
    .setFormula('="מציג " & ($D$4-$B$4+1) & " ימים  •  " & TEXT($B$4,"d/M/yyyy") & " — " & TEXT($D$4,"d/M/yyyy")')
    .setFontStyle('italic')
    .setFontColor(DBC.neutralFg)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  sh.setRowHeight(3, 36);

  // שורה 4 - שדות תאריך (מתעדכנים אוטומטית, או נערכים ידנית כש"מותאם אישית")
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  sh.getRange('A4').setValue('מתאריך:').setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('B4').setValue(firstOfMonth)
    .setNumberFormat('yyyy-mm-dd')
    .setBackground('#ffffff')
    .setHorizontalAlignment('center');

  sh.getRange('C4').setValue('עד תאריך:').setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('D4').setValue(now)
    .setNumberFormat('yyyy-mm-dd')
    .setBackground('#ffffff')
    .setHorizontalAlignment('center');

  sh.getRange('E4:M4').merge()
    .setValue('💡 בחר בורר תקופה למעלה או הקלד תאריכים ידנית כש"מותאם אישית"')
    .setFontStyle('italic')
    .setFontColor(DBC.neutralFg)
    .setHorizontalAlignment('right');

  sh.setRowHeight(4, 28);
  sh.setRowHeight(5, 15);
}

function buildKpis_(sh) {
  const flat = `'${DAILY_FLAT_TAB}'`;

  // קריטריונים משותפים לכל ה-KPI
  const storeFilter = `${flat}!C:C, IF($F$3="All","*",$F$3)`;
  const curDate = `${flat}!A:A, ">="&$B$4, ${flat}!A:A, "<="&$D$4`;
  // תקופה קודמת באותה לאורך
  const prevDate = `${flat}!A:A, ">="&($B$4-($D$4-$B$4+1)), ${flat}!A:A, "<="&($B$4-1)`;

  const kpis = [
    {
      labelRange: 'A6:C6',
      valueRange: 'A7:C7',
      verbalRange: 'A8:C8',
      deltaRange: 'A9:C9',
      label: 'ROAS לתקופה',
      // ממוצע משוקלל: סך הכנסות / סך הוצאות. זהה למה ששורת "סך הכל" בטאבי החנויות מציגה.
      formulaCur: `=IFERROR(SUMIFS(${flat}!G:G, ${curDate}, ${storeFilter}) / SUMIFS(${flat}!F:F, ${curDate}, ${storeFilter}), 0)`,
      formulaPrev: `=IFERROR(SUMIFS(${flat}!G:G, ${prevDate}, ${storeFilter}) / SUMIFS(${flat}!F:F, ${prevDate}, ${storeFilter}), 0)`,
      format: '0.00',
      verbal: true,
    },
    {
      labelRange: 'D6:F6',
      valueRange: 'D7:F7',
      verbalRange: 'D8:F8',
      deltaRange: 'D9:F9',
      label: 'סך הכנסות',
      formulaCur: `=IFERROR(SUMIFS(${flat}!G:G, ${curDate}, ${storeFilter}), 0)`,
      formulaPrev: `=IFERROR(SUMIFS(${flat}!G:G, ${prevDate}, ${storeFilter}), 0)`,
      format: '"CAD "#,##0',
      verbal: false,
    },
    {
      labelRange: 'G6:I6',
      valueRange: 'G7:I7',
      verbalRange: 'G8:I8',
      deltaRange: 'G9:I9',
      label: 'סך הוצאות',
      formulaCur: `=IFERROR(SUMIFS(${flat}!F:F, ${curDate}, ${storeFilter}), 0)`,
      formulaPrev: `=IFERROR(SUMIFS(${flat}!F:F, ${prevDate}, ${storeFilter}), 0)`,
      format: '"CAD "#,##0',
      verbal: false,
    },
    {
      labelRange: 'J6:M6',
      valueRange: 'J7:M7',
      verbalRange: 'J8:M8',
      deltaRange: 'J9:M9',
      label: 'רווח גולמי',
      formulaCur: `=IFERROR(SUMIFS(${flat}!I:I, ${curDate}, ${storeFilter}), 0)`,
      formulaPrev: `=IFERROR(SUMIFS(${flat}!I:I, ${prevDate}, ${storeFilter}), 0)`,
      format: '"CAD "#,##0',
      verbal: false,
    },
  ];

  // הסתר עמודות "private" של הערך הקודם בטור N (לחישוב delta)
  // נשתמש בעמודה N כ-helper לערכי "previous period" - מוסתרים מהמשתמש
  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i];
    const prevCell = `N${6 + i}`; // N6=prev ROAS, N7=prev Revenue, N8=prev Spend, N9=prev Profit
    sh.getRange(prevCell).setFormula(k.formulaPrev).setNumberFormat(k.format);

    // תווית
    sh.getRange(k.labelRange).merge()
      .setValue(k.label)
      .setFontWeight('bold')
      .setFontSize(11)
      .setBackground(DBC.cardLabelBg)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // ערך גדול
    sh.getRange(k.valueRange).merge()
      .setFormula(k.formulaCur)
      .setNumberFormat(k.format)
      .setFontWeight('bold')
      .setFontSize(26)
      .setBackground(DBC.cardValueBg)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // תווית מילולית (רק ל-ROAS)
    if (k.verbal) {
      sh.getRange(k.verbalRange).merge()
        .setFormula(
          `=IF(${k.valueRange.split(':')[0]}=0, "אין נתונים", ` +
          `IF(${k.valueRange.split(':')[0]}<2, "דורש בחינה", ` +
          `IF(${k.valueRange.split(':')[0]}<2.7, "סביר", ` +
          `IF(${k.valueRange.split(':')[0]}<=3, "טוב", "מעולה"))))`
        )
        .setFontWeight('bold')
        .setFontSize(12)
        .setBackground(DBC.cardValueBg)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
    } else {
      sh.getRange(k.verbalRange).merge()
        .setValue('')
        .setBackground(DBC.cardValueBg);
    }

    // שינוי מהתקופה הקודמת (delta)
    const curCol = k.valueRange.split(':')[0]; // לדוגמה "A7"
    const deltaFormula =
      `=IF(${prevCell}=0, "ללא השוואה", ` +
      `IF(${curCol}>${prevCell}, "▲ ", IF(${curCol}<${prevCell}, "▼ ", "● ")) & ` +
      `TEXT(ABS((${curCol}-${prevCell})/${prevCell}), "0.0%") & " מהתקופה הקודמת")`;
    sh.getRange(k.deltaRange).merge()
      .setFormula(deltaFormula)
      .setFontSize(11)
      .setBackground(DBC.cardValueBg)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }

  // עיצוב עמודה N (העזר לערכים קודמים) - מוסתר ע"י כיווץ
  sh.setColumnWidth(14, 1); // הסתר ויזואלית - רוחב 1 פיקסל

  sh.setRowHeight(6, 28);
  sh.setRowHeight(7, 50);
  sh.setRowHeight(8, 24);
  sh.setRowHeight(9, 26);
  sh.setRowHeight(10, 15);

  // עיצוב מותנה לתווית מילולית של ROAS (A8)
  const verbalRoas = sh.getRange('A8');
  const rules = sh.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('דורש בחינה')
    .setBackground(ROAS_COLORS.red).setFontColor('#a50e0e').setBold(true)
    .setRanges([verbalRoas]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('סביר')
    .setBackground(ROAS_COLORS.orange).setFontColor('#b06000').setBold(true)
    .setRanges([verbalRoas]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('טוב')
    .setBackground(ROAS_COLORS.green).setFontColor('#137333').setBold(true)
    .setRanges([verbalRoas]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('מעולה')
    .setBackground(ROAS_COLORS.blue).setFontColor('#0b5394').setBold(true)
    .setRanges([verbalRoas]).build());

  // עיצוב מותנה ל-delta cells (חיובי=ירוק, שלילי=אדום)
  const deltaCells = sh.getRange('A9:M9');
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ISNUMBER(SEARCH("▲", A9))')
    .setBackground(DBC.positiveBg).setFontColor(DBC.positiveFg)
    .setRanges([deltaCells]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=ISNUMBER(SEARCH("▼", A9))')
    .setBackground(DBC.negativeBg).setFontColor(DBC.negativeFg)
    .setRanges([deltaCells]).build());

  sh.setConditionalFormatRules(rules);
}

function buildInsights_(sh) {
  // כותרת הקטע
  sh.getRange('A11:M11').merge()
    .setValue('💡 תובנות מהירות')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DBC.sectionBg)
    .setFontColor(DBC.sectionFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(11, 30);

  const helpers = `'${DASHBOARD_HELPERS_TAB}'`;

  // תובנה 1: חנות מובילה (ROAS הכי גבוה)
  sh.getRange('A12:M12').merge()
    .setFormula(
      `=IFERROR(` +
      `"🏆  חנות מובילה לתקופה: " & INDEX(${helpers}!N:N, 4) & ` +
      `"  •  ROAS " & TEXT(INDEX(${helpers}!Q:Q, 4), "0.00") & ` +
      `"  •  הכנסות CAD " & TEXT(INDEX(${helpers}!O:O, 4), "#,##0"), ` +
      `"אין נתונים לתקופה")`
    )
    .setBackground(DBC.insightBg)
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  // תובנה 2: חנות בסיכון (ROAS הכי נמוך)
  sh.getRange('A13:M13').merge()
    .setFormula(
      `=IFERROR(` +
      `"⚠️  דורש תשומת לב: " & INDEX(SORT(${helpers}!N4:Q10, 4, TRUE), 1, 1) & ` +
      `"  •  ROAS " & TEXT(INDEX(SORT(${helpers}!N4:Q10, 4, TRUE), 1, 4), "0.00"), ` +
      `"")`
    )
    .setBackground(DBC.insightBg)
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  // תובנה 3: היום הכי טוב בתקופה
  sh.getRange('A14:M14').merge()
    .setFormula(
      `=IFERROR(` +
      `"📅  היום הכי טוב בתקופה: " & TEXT(INDEX(${helpers}!S:S, 4), "dd/MM/yyyy") & ` +
      `"  •  ROAS " & TEXT(INDEX(${helpers}!V:V, 4), "0.00") & ` +
      `"  •  הכנסות CAD " & TEXT(INDEX(${helpers}!T:T, 4), "#,##0"), ` +
      `"")`
    )
    .setBackground(DBC.insightBg)
    .setFontSize(12)
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  sh.setRowHeight(12, 30);
  sh.setRowHeight(13, 30);
  sh.setRowHeight(14, 30);
  sh.setRowHeight(15, 15);
}

function buildChart_(sh, ss) {
  sh.getRange('A16:M16').merge()
    .setValue('📈 מגמת ROAS לאורך זמן')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DBC.sectionBg)
    .setFontColor(DBC.sectionFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(16, 30);

  const helpers = ss.getSheetByName(DASHBOARD_HELPERS_TAB);
  if (!helpers) return;

  // ודא שה-QUERY ב-helpers הסתיים לפני שקוראים את הכותרות
  SpreadsheetApp.flush();

  // קרא את שורת הכותרות (A3:L3) - שמות החנויות בסדר שמופיע בגרף
  const headerRow = helpers.getRange('A3:L3').getValues()[0];
  const chartStores = [];
  for (let i = 1; i < headerRow.length; i++) {
    if (headerRow[i]) chartStores.push(String(headerRow[i]));
  }

  // צבעים מובחנים, באותו סדר של העמודות בגרף
  const chartColors = ['#1c4587', '#ea4335', '#34a853', '#fbbc04', '#9c27b0', '#00acc1'];

  const chart = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(helpers.getRange('A3:L500'))
    .setPosition(17, 1, 0, 0)
    .setOption('title', '')
    .setOption('legend', { position: 'top', alignment: 'center', textStyle: { fontSize: 13, bold: true } })
    .setOption('hAxis', { title: '', format: 'd/M', slantedText: false })
    .setOption('vAxis', { title: 'ROAS', minValue: 0, gridlines: { count: 5 } })
    .setOption('width', 1100)
    .setOption('height', 320)
    .setOption('curveType', 'function')
    .setOption('pointSize', 6)
    .setOption('lineWidth', 3)
    .setOption('backgroundColor', '#ffffff')
    .setOption('colors', chartColors)
    .useFirstColumnAsDomain()
    .build();
  sh.insertChart(chart);

  // מקרא ידני מתחת לגרף - תיבת צבע + שם חנות + ROAS בתקופה.
  // מבטיח שיהיה ברור מי מי גם אם ה-legend של הגרף עצמו לא מציג טוב.
  buildChartLegend_(sh, chartStores, chartColors);
}

function buildChartLegend_(sh, chartStores, chartColors) {
  // כותרת המקרא
  sh.getRange('A33:M33').merge()
    .setValue('🎨 מקרא — איזה צבע מסמן איזו חנות')
    .setFontWeight('bold')
    .setFontSize(11)
    .setBackground('#f3f3f3')
    .setFontColor('#5f6368')
    .setHorizontalAlignment('center');
  sh.setRowHeight(33, 26);

  // לכל חנות: תיבת צבע (עמודה B) + שם (C:F) + ROAS בתקופה (G:I)
  const flat = `'${DAILY_FLAT_TAB}'`;
  for (let i = 0; i < chartStores.length; i++) {
    const row = 34 + i;
    const storeName = chartStores[i];
    const color = chartColors[i % chartColors.length];

    sh.getRange(row, 2).setBackground(color).setValue('')
      .setBorder(true, true, true, true, false, false, '#999999', SpreadsheetApp.BorderStyle.SOLID);

    sh.getRange(row, 3, 1, 4).merge()
      .setValue('  ' + storeName)
      .setFontWeight('bold')
      .setFontSize(13)
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');

    // ROAS לתקופה לחנות הזו (לא תלוי בסינון של $F$3)
    const roasFormula =
      `=IFERROR("ROAS לתקופה: " & TEXT(` +
      `SUMIFS(${flat}!G:G, ${flat}!A:A, ">="&$B$4, ${flat}!A:A, "<="&$D$4, ${flat}!C:C, "${storeName.replace(/"/g, '""')}") / ` +
      `SUMIFS(${flat}!F:F, ${flat}!A:A, ">="&$B$4, ${flat}!A:A, "<="&$D$4, ${flat}!C:C, "${storeName.replace(/"/g, '""')}"), ` +
      `"0.00"), "—")`;
    sh.getRange(row, 7, 1, 4).merge()
      .setFormula(roasFormula)
      .setFontSize(12)
      .setFontColor('#5f6368')
      .setHorizontalAlignment('right')
      .setVerticalAlignment('middle');

    sh.setRowHeight(row, 26);
  }
}

function buildTable_(sh) {
  const flat = `'${DAILY_FLAT_TAB}'`;

  sh.getRange('A40:M40').merge()
    .setValue('📋 פירוט יומי')
    .setFontWeight('bold')
    .setFontSize(13)
    .setBackground(DBC.sectionBg)
    .setFontColor(DBC.sectionFg)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sh.setRowHeight(40, 30);
  sh.setRowHeight(41, 10);

  const queryFormula =
    `=IFERROR(QUERY(${flat}!A:I, ` +
    `"SELECT A, C, D, E, F, G, H, I ` +
    `WHERE A IS NOT NULL ` +
    `AND A >= date '"&TEXT($B$4,"yyyy-MM-dd")&"' ` +
    `AND A <= date '"&TEXT($D$4,"yyyy-MM-dd")&"' "` +
    `&IF($F$3<>"All", "AND C = '"&$F$3&"' ", "")` +
    `&"ORDER BY A DESC LIMIT 100 ` +
    `LABEL A 'תאריך', C 'חנות', D 'פייסבוק', E 'גוגל', F 'סה""כ הוצאה', ` +
    `G 'הכנסה', H 'ROAS', I 'רווח גולמי' ` +
    `FORMAT A 'd/M/yyyy', D '#,##0.00', E '#,##0.00', F '#,##0.00', ` +
    `G '#,##0.00', H '0.00', I '#,##0.00'", 1), ` +
    `"אין נתונים בטווח שבחרת")`;

  sh.getRange('A42').setFormula(queryFormula);

  // עיצוב שורת הכותרת של ה-QUERY
  sh.getRange('A42:H42')
    .setFontWeight('bold')
    .setBackground(DBC.cardLabelBg)
    .setHorizontalAlignment('center');

  // צביעת ROAS על עמודה G (העמודה השביעית בפלט)
  const roasRange = sh.getRange('G43:G500');
  const rules = sh.getConditionalFormatRules();
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(2).setBackground(ROAS_COLORS.red).setRanges([roasRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2, 2.6999).setBackground(ROAS_COLORS.orange).setRanges([roasRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(2.7, 3).setBackground(ROAS_COLORS.green).setRanges([roasRange]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(3).setBackground(ROAS_COLORS.blue).setRanges([roasRange]).build());
  sh.setConditionalFormatRules(rules);
}

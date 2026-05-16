/**
 * DailyUpdate.gs - תזמור התהליך היומי.
 * 1. שלוף שער ILS->CAD ליום
 * 2. לכל חנות: Shopify revenue + Meta spend (+ Google Ads spend ל-uzoshop)
 * 3. המר ILS->CAD לפי הצורך
 * 4. כתוב לשורה היומית בטאב החנות
 * 5. צבור לטאב הסיכום
 */

function runDailyUpdate() {
  runUpdateForDate(yesterdayStr_());
}

/**
 * עדכון "חי" - מריץ עבור היום הנוכחי במקום אתמול. שימושי לטריגר תכוף יותר
 * (כל 15 דקות) כדי להציג את מצב היום עד לרגע הזה ב-dashboard.
 */
function runLiveUpdate() {
  runUpdateForDate(todayStr_());
}

function runUpdateForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`תאריך לא תקין: ${dateStr}. נדרש פורמט YYYY-MM-DD.`);
  }

  const ss = ensureSpreadsheet();
  const [year, month, day] = dateStr.split('-').map(Number);

  const ilsToCad = getFxRate('ILS', 'CAD', dateStr);
  Logger.log(`FX ILS->CAD on ${dateStr}: ${ilsToCad}`);

  const errors = [];

  for (const store of STORES) {
    try {
      updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
    } catch (e) {
      errors.push(`[${store.name}] ${e && e.message ? e.message : e}`);
      Logger.log(`ERROR ${store.name}: ${e && e.stack ? e.stack : e}`);
    }
  }

  // הסיכום מבוסס נוסחאות - מספיק להבטיח שבלוק החודש קיים כדי שהנוסחאות
  // ימשכו אוטומטית את הערכים מהטאבים של החנויות.
  try {
    const summarySheet = ss.getSheetByName(SUMMARY_TAB);
    writeDayRow(summarySheet, year, month, day, 0, 0, 0);
  } catch (e) {
    errors.push(`[summary] ${e && e.message ? e.message : e}`);
  }

  if (errors.length) {
    const msg = `ROAS daily update ${dateStr} completed with errors:\n` + errors.join('\n');
    Logger.log(msg);
    notifyError_(dateStr, msg);
  }
}

function updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad) {
  const revenueCad = getShopifyRevenue(store.id, dateStr);

  const meta = getMetaSpend(store.id, dateStr);
  const metaCad = meta.currency === 'CAD' ? meta.spend : meta.spend * ilsToCad;

  let googleAdsCad = 0;
  if (store.hasGoogleAds) {
    const ga = getGoogleAdsSpend(store.id, dateStr);
    googleAdsCad = ga.currency === 'CAD' ? ga.spend : ga.spend * getFxRate(ga.currency, 'CAD', dateStr);
  }

  const totalSpentCad = metaCad + googleAdsCad;
  const sheet = ss.getSheetByName(store.name);
  if (!sheet) throw new Error(`לא נמצא טאב לחנות ${store.name}`);
  writeDayRow(sheet, year, month, day, metaCad, googleAdsCad, revenueCad);

  // שכבת קמפיינים/אד-סטים. נכשל ברך - לא יפיל את הסיכום היומי אם API קמפיינים שובת.
  try {
    updateCampaignDataForStoreDate_(ss, store, dateStr, ilsToCad);
  } catch (e) {
    Logger.log(`Campaign-level data for ${store.name} ${dateStr} failed: ${e && e.message ? e.message : e}`);
  }

  // COGS - מחושב כ-25% מההכנסה היומית (הערכה גסה: עלות סחורה ≈ רבע מהמכירה).
  // מוגדר ב-Config.gs ב-COGS_RATE_OF_REVENUE כדי להקל על שינויים עתידיים.
  const cogsCad = revenueCad * COGS_RATE_OF_REVENUE;

  // טאב daily-flat ל-Looker Studio / Web Dashboard
  try {
    writeDailyFlatRow_(ss, dateStr, store.id, store.name, metaCad, googleAdsCad, revenueCad, cogsCad);
  } catch (e) {
    Logger.log(`daily-flat write for ${store.name} ${dateStr} failed: ${e && e.message ? e.message : e}`);
  }

  Logger.log(`${store.name} ${dateStr}: spent=${totalSpentCad.toFixed(2)} CAD (FB ${metaCad.toFixed(2)} + GA ${googleAdsCad.toFixed(2)}), revenue=${revenueCad.toFixed(2)} CAD`);
  return { spent: totalSpentCad, revenue: revenueCad };
}

/**
 * שולף נתוני אד-סט/אד-גרופ מ-Meta + Google ליום הזה, ממיר ל-CAD וכותב לטאב הקמפיינים.
 */
function updateCampaignDataForStoreDate_(ss, store, dateStr, ilsToCad) {
  const rows = [];

  // Meta - תמיד יש (כל החנויות מפרסמות שם)
  try {
    const metaRows = getMetaAdSetInsights(store.id, dateStr);
    for (const r of metaRows) {
      const fxToCad = r.currency === 'CAD' ? 1
                    : r.currency === 'ILS' ? ilsToCad
                    : getFxRate(r.currency, 'CAD', dateStr);
      rows.push({
        date: dateStr,
        platform: 'Meta',
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        adSetId: r.adSetId,
        adSetName: r.adSetName,
        spendCad: r.spend * fxToCad,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversionValueCad: r.conversionValue * fxToCad,
      });
    }
  } catch (e) {
    Logger.log(`Meta ad-sets ${store.name} ${dateStr} fetch failed: ${e && e.message ? e.message : e}`);
  }

  // Google Ads - רק לחנויות עם hasGoogleAds=true
  if (store.hasGoogleAds) {
    try {
      const gaRows = getGoogleAdsAdGroupInsights(store.id, dateStr);
      for (const r of gaRows) {
        const fxToCad = r.currency === 'CAD' ? 1
                      : r.currency === 'ILS' ? ilsToCad
                      : getFxRate(r.currency, 'CAD', dateStr);
        rows.push({
          date: dateStr,
          platform: 'Google',
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          adSetId: r.adSetId,
          adSetName: r.adSetName,
          spendCad: r.spend * fxToCad,
          impressions: r.impressions,
          clicks: r.clicks,
          conversions: r.conversions,
          conversionValueCad: r.conversionValue * fxToCad,
        });
      }
    } catch (e) {
      Logger.log(`Google Ads ad-groups ${store.name} ${dateStr} fetch failed: ${e && e.message ? e.message : e}`);
    }
  }

  writeCampaignRowsForDay(ss, store.id, dateStr, rows);
  Logger.log(`Campaign data ${store.name} ${dateStr}: wrote ${rows.length} rows`);
}

/**
 * מילוי היסטורי לטווח תאריכים, לכל החנויות + סיכום.
 * שים לב: כל הרצה מוגבלת ל-6 דקות במכסת Apps Script.
 */
function backfillRange(startDateStr, endDateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
    throw new Error('תאריכים לא תקינים');
  }
  let cur = startDateStr;
  while (cur <= endDateStr) {
    Logger.log(`-- Backfill ${cur} --`);
    runUpdateForDate(cur);
    cur = nextDayStr_(cur);
  }
}

/**
 * מילוי היסטורי **רק לחנויות ספציפיות**. שימושי כשרוצים למלא חנות אחת או שתיים
 * בלי להפעיל קריאות API לחנויות אחרות (לדוגמה אחרי שכבר מילאת את uzoshop).
 *
 * 💡 טאב הסיכום מתעדכן אוטומטית: הוא מבוסס נוסחאות שמושכות מהטאבים של החנויות
 * דרך VLOOKUP, אז אין צורך להריץ עליו backfill נפרד.
 *
 * @param startDateStr  פורמט YYYY-MM-DD
 * @param endDateStr    פורמט YYYY-MM-DD
 * @param storeIds      מערך מזהי חנויות, לדוגמה ['zolplus', 'usmile360']
 */
function backfillRangeForStores(startDateStr, endDateStr, storeIds) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
    throw new Error('תאריכים לא תקינים');
  }
  const stores = STORES.filter(s => storeIds.indexOf(s.id) >= 0);
  if (stores.length === 0) {
    throw new Error(`לא נמצאו חנויות תואמות ב-${storeIds.join(', ')}`);
  }
  Logger.log(`Backfilling stores: ${stores.map(s => s.name).join(', ')} (summary tab will NOT be updated)`);

  let cur = startDateStr;
  while (cur <= endDateStr) {
    Logger.log(`-- Backfill ${cur} (partial) --`);
    runUpdateForDateForStores_(cur, stores);
    cur = nextDayStr_(cur);
  }
}

function runUpdateForDateForStores_(dateStr, stores) {
  const ss = ensureSpreadsheet();
  const [year, month, day] = dateStr.split('-').map(Number);
  const ilsToCad = getFxRate('ILS', 'CAD', dateStr);
  Logger.log(`FX ILS->CAD on ${dateStr}: ${ilsToCad}`);

  for (const store of stores) {
    try {
      updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
    } catch (e) {
      Logger.log(`ERROR ${store.name} ${dateStr}: ${e && e.stack ? e.stack : e}`);
    }
  }

  // הסיכום מבוסס נוסחאות - גם בעדכון חלקי, ודא שהבלוק החודשי קיים בטאב הסיכום
  // כדי שהנוסחאות יחושבו.
  try {
    const summarySheet = ss.getSheetByName(SUMMARY_TAB);
    writeDayRow(summarySheet, year, month, day, 0, 0, 0);
  } catch (e) {
    Logger.log(`Summary block ensure error: ${e}`);
  }
}

/** קיצור דרך נוח: מילוי 01-14 במאי 2026 רק ל-Zol Plus ול-360usmile. */
function backfillZolUsmileMay1to14() {
  backfillRangeForStores('2026-05-01', '2026-05-14', ['zolplus', 'usmile360']);
}

/**
 * Debug helper - מדפיס ללוג את כל הנתונים הגולמיים של היום עבור כל חנות
 * **לפני המרה ל-CAD**, כך שאפשר להשוות מול הפלטפורמה (Meta / Google / Shopify).
 *
 * הרץ מהעורך כשהדשבורד נראה לא מסונכרן עם הפלטפורמה כדי לאתר את מקור הפער.
 * הפלט יוצא ל-View → Logs.
 */
function debugTodaySpend() {
  const dateStr = todayStr_();
  const ilsToCad = getFxRate('ILS', 'CAD', dateStr);
  Logger.log(`===== DEBUG ${dateStr} =====`);
  Logger.log(`FX ILS->CAD = ${ilsToCad}  (1 ILS = ${ilsToCad} CAD)`);
  Logger.log('');

  for (const store of STORES) {
    Logger.log(`----- ${store.name} (${store.id}) -----`);

    // Shopify revenue
    try {
      const revCad = getShopifyRevenue(store.id, dateStr);
      Logger.log(`  Shopify revenue: ${revCad.toFixed(2)} CAD (Shopify מחזיר ב-CAD ישירות)`);
    } catch (e) {
      Logger.log(`  Shopify revenue ERROR: ${e && e.message ? e.message : e}`);
    }

    // Meta spend
    try {
      const meta = getMetaSpend(store.id, dateStr);
      const metaCad = meta.currency === 'CAD' ? meta.spend : meta.spend * ilsToCad;
      Logger.log(`  Meta spend  : ${meta.spend.toFixed(2)} ${meta.currency}` +
                 `  →  ${metaCad.toFixed(2)} CAD` +
                 (meta.currency === 'ILS' ? `  (× ${ilsToCad})` : ''));
    } catch (e) {
      Logger.log(`  Meta spend ERROR: ${e && e.message ? e.message : e}`);
    }

    // Google Ads spend (אם רלוונטי)
    if (store.hasGoogleAds) {
      try {
        const ga = getGoogleAdsSpend(store.id, dateStr);
        const fx = ga.currency === 'CAD' ? 1 : getFxRate(ga.currency, 'CAD', dateStr);
        const gaCad = ga.spend * fx;
        Logger.log(`  Google spend: ${ga.spend.toFixed(2)} ${ga.currency}` +
                   `  →  ${gaCad.toFixed(2)} CAD` +
                   (fx !== 1 ? `  (× ${fx})` : ''));
      } catch (e) {
        Logger.log(`  Google spend ERROR: ${e && e.message ? e.message : e}`);
      }
    } else {
      Logger.log(`  Google spend: — (החנות לא משתמשת ב-Google Ads)`);
    }
    Logger.log('');
  }
  Logger.log('===== END DEBUG =====');
  Logger.log('להשוות:');
  Logger.log('  Meta:    business.facebook.com → Ads Manager → סנן לתאריך היום → "Amount spent" (במטבע החשבון)');
  Logger.log('  Google:  ads.google.com → Campaigns → סנן Today → "Cost" (במטבע החשבון)');
  Logger.log('  Shopify: admin.shopify.com → Orders → Total sales היום');
}

function notifyError_(dateStr, message) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (email) {
      MailApp.sendEmail({
        to: email,
        subject: `ROAS Tracker - שגיאות בעדכון ${dateStr}`,
        body: message,
      });
    }
  } catch (_) { /* silent */ }
}

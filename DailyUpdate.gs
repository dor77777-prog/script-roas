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

function runUpdateForDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`תאריך לא תקין: ${dateStr}. נדרש פורמט YYYY-MM-DD.`);
  }

  const ss = ensureSpreadsheet();
  const [year, month, day] = dateStr.split('-').map(Number);

  const ilsToCad = getFxRate('ILS', 'CAD', dateStr);
  Logger.log(`FX ILS->CAD on ${dateStr}: ${ilsToCad}`);

  let summarySpent = 0;
  let summaryRevenue = 0;
  const errors = [];

  for (const store of STORES) {
    try {
      const result = updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
      summarySpent += result.spent;
      summaryRevenue += result.revenue;
    } catch (e) {
      errors.push(`[${store.name}] ${e && e.message ? e.message : e}`);
      Logger.log(`ERROR ${store.name}: ${e && e.stack ? e.stack : e}`);
    }
  }

  try {
    const summarySheet = ss.getSheetByName(SUMMARY_TAB);
    writeDayRow(summarySheet, year, month, day, summarySpent, summaryRevenue);
    Logger.log(`SUMMARY ${dateStr}: spent=${summarySpent.toFixed(2)} CAD, revenue=${summaryRevenue.toFixed(2)} CAD`);
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
  writeDayRow(sheet, year, month, day, totalSpentCad, revenueCad);

  Logger.log(`${store.name} ${dateStr}: spent=${totalSpentCad.toFixed(2)} CAD (FB ${metaCad.toFixed(2)} + GA ${googleAdsCad.toFixed(2)}), revenue=${revenueCad.toFixed(2)} CAD`);
  return { spent: totalSpentCad, revenue: revenueCad };
}

/**
 * מילוי היסטורי לטווח תאריכים. שימושי אחרי הקמה ראשונית.
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

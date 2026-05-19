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

/**
 * Per-store daily trigger entry points (Phase 5).
 *
 * Each gets its own 6-min budget — eliminates the quota cascade where
 * store 2 + 3 used to time out because store 1 saturated the Sheets API
 * short-window quota. installDailyTrigger installs each at a different
 * minute (00:05, 00:08, 00:11) so they run sequentially but in
 * INDEPENDENT executions (each has its own 6-min cap).
 *
 * The original runDailyUpdate() is retained as a MANUAL entry point
 * for full-sequential runs (e.g., from the editor / spreadsheet menu).
 * Triggers no longer call it directly.
 */
function runDailyUpdateUzoshop() {
  runUpdateForSingleStore_('uzoshop', yesterdayStr_());
}
function runDailyUpdateZolplus() {
  runUpdateForSingleStore_('zolplus', yesterdayStr_());
}
function runDailyUpdateUsmile() {
  const dateStr = yesterdayStr_();
  runUpdateForSingleStore_('usmile360', dateStr);
  // Phase 5 (CR-01 fix): the per-store wrappers do not touch the summary
  // tab on their own, but the summary tab needs writeDayRow() at least
  // once per day so that getOrCreateMonthBlock_ creates the new-month
  // block when a month boundary is crossed. The summary itself is
  // formula-driven — the third per-store run is enough to keep it
  // consistent for any date.
  //
  // Done here (the LAST per-store wrapper) rather than in each wrapper
  // so we only pay the cost once. Failures are swallowed: missing a
  // month-block refresh is a UX glitch on day 1 of the month, NOT a
  // data-loss failure, and we do NOT want to notifyError_ over it.
  try {
    ensureSummaryMonthBlock_(dateStr);
  } catch (e) {
    Logger.log(`[summary] month-block refresh failed (non-fatal): ${e && e.message ? e.message : e}`);
  }
}

/**
 * Per-store LIVE trigger entry points (Phase 5.1).
 *
 * Mirrors the daily per-store split (Phase 5) — each gets its OWN
 * 6-min budget so a slow Shopify/Meta response on one store can't
 * cascade into a timeout for the others. Triggers run independently
 * every 15 minutes via installLiveTrigger().
 *
 * The original runLiveUpdate() is retained as a MANUAL entry point
 * for full-sequential runs (e.g., from the editor / spreadsheet menu).
 * Triggers no longer call it directly.
 */
function runLiveUpdateUzoshop() {
  runUpdateForSingleStore_('uzoshop', todayStr_());
}
function runLiveUpdateZolplus() {
  runUpdateForSingleStore_('zolplus', todayStr_());
}
function runLiveUpdateUsmile() {
  runUpdateForSingleStore_('usmile360', todayStr_());
}

/**
 * Writes a zero-row to the summary tab for `dateStr`. The summary tab
 * is formula-driven — we only need writeDayRow() to fire so that
 * getOrCreateMonthBlock_ runs and creates the block for a new month.
 * Idempotent: if the row already exists it is overwritten with the
 * same zero values.
 */
function ensureSummaryMonthBlock_(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`תאריך לא תקין: ${dateStr}. נדרש פורמט YYYY-MM-DD.`);
  }
  const ss = ensureSpreadsheet();
  const [year, month, day] = dateStr.split('-').map(Number);
  const summarySheet = ss.getSheetByName(SUMMARY_TAB);
  if (!summarySheet) throw new Error(`טאב סיכום לא נמצא: ${SUMMARY_TAB}`);
  writeDayRow(summarySheet, year, month, day, 0, 0, 0);
}

/**
 * Runs updateStoreForDate_ for a SINGLE store. Used by the per-store
 * trigger entry points (Phase 5 trigger split). Mirrors the error
 * handling shape of runUpdateForDate (per-store try/catch +
 * notifyError_ on failure). Does NOT touch the summary tab itself —
 * the summary is formula-driven, and the LAST per-store wrapper
 * (runDailyUpdateUsmile) is responsible for triggering
 * ensureSummaryMonthBlock_() exactly once per day.
 */
function runUpdateForSingleStore_(storeId, dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`תאריך לא תקין: ${dateStr}. נדרש פורמט YYYY-MM-DD.`);
  }
  const store = getStoreById(storeId);
  if (!store) throw new Error(`חנות לא ידועה: ${storeId}`);

  const ss = ensureSpreadsheet();
  const [year, month, day] = dateStr.split('-').map(Number);
  const ilsToCad = getFxRate('ILS', 'CAD', dateStr);
  Logger.log(`[${store.name}] FX ILS->CAD on ${dateStr}: ${ilsToCad}`);

  const errors = [];
  try {
    updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
  } catch (e) {
    const msg = `[${store.name}] ${e && e.message ? e.message : e}`;
    errors.push(msg);
    Logger.log(`ERROR ${store.name}: ${e && e.stack ? e.stack : e}`);
  }

  if (errors.length) {
    const fullMsg = `ROAS per-store update ${dateStr} (${store.name}) completed with errors:\n` + errors.join('\n');
    Logger.log(fullMsg);
    notifyError_(dateStr, fullMsg);
  }
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

  for (let i = 0; i < STORES.length; i++) {
    const store = STORES[i];
    // Breathe between stores so the Sheets API short-window quota has
    // time to recover. Without this, store 2 and 3 were timing out
    // because store 1's ~10k-cell writes (campaigns + ads + products +
    // orders-attribution) saturated the quota window. 1.5s isn't free
    // but it's well under the runtime budget (~6 min total for 3 stores).
    if (i > 0) Utilities.sleep(1500);
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

  // store-meta: רענון יומי של שם תוכנית Shopify לכל חנות (לא קריטי, שגיאות לא מפילות).
  try {
    refreshAllStoreMeta();
  } catch (e) {
    Logger.log(`store-meta refresh failed (non-fatal): ${e && e.message ? e.message : e}`);
  }

  if (errors.length) {
    const msg = `ROAS daily update ${dateStr} completed with errors:\n` + errors.join('\n');
    Logger.log(msg);
    notifyError_(dateStr, msg);
  }
}

function updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad) {
  const revenueCad = getShopifyRevenue(store.id, dateStr);

  // Meta: override ידני קודם, נופלים ל-API אם אין.
  const metaOverride = getManualSpendOverride_(store.id, 'Meta', dateStr);
  let meta;
  let metaFromOverride = false;
  if (metaOverride) {
    meta = metaOverride;
    metaFromOverride = true;
    Logger.log(`Meta OVERRIDE ${store.name} ${dateStr}: ${meta.spend} ${meta.currency} (manual-spend tab)`);
  } else {
    meta = getMetaSpend(store.id, dateStr);
  }
  // המרה ל-CAD תומכת ב-ILS/USD/EUR/CAD; שאר המטבעות יעברו דרך Frankfurter.
  const metaCad = meta.currency === 'CAD' ? meta.spend
                : meta.currency === 'ILS' ? meta.spend * ilsToCad
                : meta.spend * getFxRate(meta.currency, 'CAD', dateStr);

  let googleAdsCad = 0;
  let gaFromOverride = false;
  if (store.hasGoogleAds) {
    const gaOverride = getManualSpendOverride_(store.id, 'Google', dateStr);
    let ga;
    if (gaOverride) {
      ga = gaOverride;
      gaFromOverride = true;
      Logger.log(`Google OVERRIDE ${store.name} ${dateStr}: ${ga.spend} ${ga.currency} (manual-spend tab)`);
    } else {
      ga = getGoogleAdsSpend(store.id, dateStr);
    }
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
  // Pause between major batch-writes so the Sheets API quota window
  // gets a moment to refresh. ~500ms is enough to noticeably reduce
  // timeouts during multi-store runs.
  Utilities.sleep(500);

  // COGS - מחושב כ-25% מההכנסה היומית (הערכה גסה: עלות סחורה ≈ רבע מהמכירה).
  // מוגדר ב-Config.gs ב-COGS_RATE_OF_REVENUE כדי להקל על שינויים עתידיים.
  const cogsCad = revenueCad * COGS_RATE_OF_REVENUE;

  // טאב daily-flat ל-Looker Studio / Web Dashboard
  try {
    writeDailyFlatRow_(ss, dateStr, store.id, store.name, metaCad, googleAdsCad, revenueCad, cogsCad);
  } catch (e) {
    Logger.log(`daily-flat write for ${store.name} ${dateStr} failed: ${e && e.message ? e.message : e}`);
  }

  // טאב products-daily - breakdown של מוצרים שנמכרו ביום זה
  try {
    const products = getShopifyProductSalesForDay(store.id, dateStr);
    writeProductSalesForDay_(ss, dateStr, store.id, store.name, products);
  } catch (e) {
    Logger.log(`products-daily for ${store.name} ${dateStr} failed (non-fatal): ${e && e.message ? e.message : e}`);
  }
  Utilities.sleep(500);

  // טאב <store>-ads — drill-down מודעות מתחת ל-ad-sets. נכשל ברך כדי לא
  // להפיל את הריצה היומית אם Meta מחזיר 5xx לעומס insights ברמת ad.
  try {
    updateAdDataForStoreDate_(ss, store, dateStr, ilsToCad);
  } catch (e) {
    Logger.log(`Ad-level data for ${store.name} ${dateStr} failed: ${e && e.message ? e.message : e}`);
  }
  Utilities.sleep(500);

  // טאב <store>-orders-attribution — שורה לכל הזמנה עם classification של
  // ערוץ הטראפיק (UTM + fbclid + gclid + referrer). מאפשר לדשבורד להבדיל
  // בין conversions שיש להן click-id אמיתי לבין conversions ש-Meta דיווח
  // עליהן בלי click (modeled / view-through). נכשל ברך — אם Shopify
  // חזר 5xx, הרצות אחרות לא נפגעות.
  try {
    const attribution = getShopifyOrdersAttribution(store.id, dateStr);
    writeOrdersAttributionForDay(ss, store.id, dateStr, attribution);
  } catch (e) {
    Logger.log(`Orders attribution ${store.name} ${dateStr} failed (non-fatal): ${e && e.message ? e.message : e}`);
  }

  // Product catalog is NOT refreshed inside runDailyUpdate anymore — the
  // 200-500 row × 9 col write per store alongside the campaigns + ads
  // writes consistently exhausts Sheets API short-window quota and
  // cascades into "Service Spreadsheets timed out" for the LATER stores
  // in the loop. Each store after the first was failing.
  //
  // Catalog is a low-volatility resource (operators add a product
  // weekly at most). Refreshing it is now an EXPLICIT manual action via
  // refreshAllProductCatalogs() — runs on its own Apps Script execution,
  // gets its own 6-min budget AND its own quota window, doesn't compete
  // with the daily updates.
  //
  // For ongoing awareness, we log a warning when the catalog is older
  // than 14 days so ops sees the staleness in the logs without it
  // breaking anything.
  try {
    if (catalogNeedsRefresh_(ss, store.id, 14)) {
      Logger.log(
        `⚠️ Product catalog ${store.name} is >14 days old or missing — ` +
        `run refreshAllProductCatalogs() manually to update it ` +
        `(daily run no longer auto-refreshes to avoid quota timeouts).`
      );
    }
  } catch (_) { /* age check is best-effort */ }

  Logger.log(`${store.name} ${dateStr}: spent=${totalSpentCad.toFixed(2)} CAD (FB ${metaCad.toFixed(2)} + GA ${googleAdsCad.toFixed(2)}), revenue=${revenueCad.toFixed(2)} CAD`);
  return { spent: totalSpentCad, revenue: revenueCad };
}

/**
 * שולף נתוני אד-סט/אד-גרופ מ-Meta + Google ליום הזה, ממיר ל-CAD וכותב לטאב הקמפיינים.
 */
function updateCampaignDataForStoreDate_(ss, store, dateStr, ilsToCad) {
  const rows = [];

  // Meta - מדלגים על קריאת campaign-level אם יש override ידני לאותו תאריך
  // (אין לנו granularity ידנית, רק סה"כ — אז עדיף לא לקרוא ל-API ולכתוב כלום).
  const metaOverrideForDay = getManualSpendOverride_(store.id, 'Meta', dateStr);
  if (metaOverrideForDay) {
    Logger.log(`Meta campaigns ${store.name} ${dateStr}: SKIPPED (manual override active)`);
  } else try {
    // Budgets are a current-state property (not time-windowed), so we fetch
    // them once per store per run. Failure here is non-fatal — we still write
    // spend/conversion rows, just without the budget enrichment.
    let metaBudgets = null;
    try {
      metaBudgets = getMetaBudgets(store.id);
    } catch (be) {
      Logger.log(`Meta budgets ${store.name} fetch failed (non-fatal): ${be && be.message ? be.message : be}`);
    }

    const metaRows = getMetaAdSetInsights(store.id, dateStr);
    for (const r of metaRows) {
      const fxToCad = r.currency === 'CAD' ? 1
                    : r.currency === 'ILS' ? ilsToCad
                    : getFxRate(r.currency, 'CAD', dateStr);

      // Resolve budget for this row. Logic:
      //   - If the campaign has its own budget > 0 → CBO. Show on the campaign
      //     row (campaignBudgetCad), leave adSetBudgetCad blank.
      //   - Else, if this row's ad-set has a budget > 0 → ABO. Show on the
      //     ad-set row (adSetBudgetCad), leave campaignBudgetCad blank.
      //   - Else → both blank, type empty (unknown / paused / lifetime-only
      //     with 0 remaining).
      let campaignBudgetCad = null;
      let adSetBudgetCad = null;
      let budgetType = '';
      if (metaBudgets) {
        const bFx = metaBudgets.currency === 'CAD' ? 1
                  : metaBudgets.currency === 'ILS' ? ilsToCad
                  : getFxRate(metaBudgets.currency, 'CAD', dateStr);
        const cb = metaBudgets.campaigns[r.campaignId];
        const ab = metaBudgets.adSets[r.adSetId];
        const cbDaily = cb && cb.dailyBudget > 0 ? cb.dailyBudget : 0;
        const abDaily = ab && ab.dailyBudget > 0 ? ab.dailyBudget : 0;
        if (cbDaily > 0) {
          campaignBudgetCad = cbDaily * bFx;
          budgetType = 'CBO';
        } else if (abDaily > 0) {
          adSetBudgetCad = abDaily * bFx;
          budgetType = 'ABO';
        }
      }

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
        campaignBudgetCad,
        adSetBudgetCad,
        budgetType,
      });
    }
  } catch (e) {
    Logger.log(`Meta ad-sets ${store.name} ${dateStr} fetch failed: ${e && e.message ? e.message : e}`);
  }

  // Google Ads - רק לחנויות עם hasGoogleAds=true; דילוג אם יש override
  if (store.hasGoogleAds) {
    const gaOverrideForDay = getManualSpendOverride_(store.id, 'Google', dateStr);
    if (gaOverrideForDay) {
      Logger.log(`Google campaigns ${store.name} ${dateStr}: SKIPPED (manual override active)`);
    } else try {
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
 * שולף ad-level insights מ-Meta ליום הזה ורושם לטאב <store>-ads.
 * רק Meta — Google Ads לא נסרק ברמת מודעה במסגרת הזאת.
 * מדלגים אם יש manual override (אין רזולוציה ידנית לרמת מודעה).
 */
function updateAdDataForStoreDate_(ss, store, dateStr, ilsToCad) {
  // Skip Meta only — Google has no ad-level surface here yet.
  const metaOverrideForDay = getManualSpendOverride_(store.id, 'Meta', dateStr);
  if (metaOverrideForDay) {
    Logger.log(`Meta ads ${store.name} ${dateStr}: SKIPPED (manual override active)`);
    return;
  }
  let adRows;
  try {
    adRows = getMetaAdInsights(store.id, dateStr);
  } catch (e) {
    Logger.log(`Meta ads ${store.name} ${dateStr} fetch failed: ${e && e.message ? e.message : e}`);
    return;
  }
  const rows = adRows.map(r => {
    const fxToCad = r.currency === 'CAD' ? 1
                  : r.currency === 'ILS' ? ilsToCad
                  : getFxRate(r.currency, 'CAD', dateStr);
    return {
      date: dateStr,
      platform: 'Meta',
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      adSetId: r.adSetId,
      adSetName: r.adSetName,
      adId: r.adId,
      adName: r.adName,
      spendCad: r.spend * fxToCad,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      conversionValueCad: r.conversionValue * fxToCad,
    };
  });
  writeAdsRowsForDay(ss, store.id, dateStr, rows);
  Logger.log(`Ads data ${store.name} ${dateStr}: wrote ${rows.length} rows`);
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

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    // Mirror runUpdateForDate's inter-store throttle: breathe between stores
    // so the Sheets API short-window quota has time to recover. Without this,
    // multi-store backfills (e.g. backfillRangeForStores → 28 store-day runs)
    // hit the same quota cascade that the daily run was fixing.
    if (i > 0) Utilities.sleep(1500);
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

/**
 * Sends an email when the daily update finished with errors. Resolves the
 * recipient in three layers (most specific wins):
 *   1. Script Property `notification.email`  ← set this for production triggers
 *   2. `Session.getEffectiveUser().getEmail()`  ← the script's owner (works in triggers)
 *   3. `Session.getActiveUser().getEmail()`    ← the user invoking interactively
 *
 * The previous version used only option 3, which returns empty under
 * time-based triggers (the script runs as the owner, not as an active user)
 * — meaning silent failures even though the email logic was there.
 *
 * Subject is prefixed with the number of errors so the inbox shows urgency
 * at a glance. Body includes the URL of the script so the user can jump to
 * the logs without searching.
 */
// ============================================================================
// Archive / retention (Phase 5).
//
// Moves rows older than `months` from 5 high-growth tabs into a separate
// ARCHIVE spreadsheet. Reduces the cell-count pressure on the warm
// spreadsheet (warm is currently ~6M of the 10M cell cap; without
// retention we'll cross 8M within a year).
//
// Safety:
//   - DRY-RUN by default — opts.dryRun=false must be passed explicitly
//   - Verbose logging of every (tab, rowCount, dateRange) BEFORE any write
//   - archive.spreadsheet.id MUST be set in Script Properties — throws
//     otherwise (no implicit creation, no "phantom archive" risk)
//   - Append-then-delete order: rows land in archive BEFORE removal from
//     warm, so a crash mid-run leaves duplicates (recoverable) not gaps
//     (unrecoverable). Same defensive pattern as ensureSpreadsheet.
// ============================================================================

/**
 * Returns YYYY-MM-DD that is `months` months before today (in TZ).
 */
function monthsAgoStr_(months) {
  const now = new Date();
  const tzStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const [y, m, d] = tzStr.split('-').map(Number);
  // JavaScript Date handles negative month offset correctly (e.g. month=-1 → Dec previous year).
  const dt = new Date(y, m - 1 - months, d);
  return Utilities.formatDate(dt, TZ, 'yyyy-MM-dd');
}

/**
 * Tab specs the archiver knows how to move. Each entry resolves at runtime
 * to a list of (warmTabName, archiveTabName) — the latter mirrors the
 * former. Per-store tabs expand at runtime via STORES.
 */
function ARCHIVE_TAB_SPECS_() {
  const specs = [
    { warm: DAILY_FLAT_TAB,      archive: DAILY_FLAT_TAB,      label: 'data-daily' },
    { warm: PRODUCTS_DAILY_TAB,  archive: PRODUCTS_DAILY_TAB,  label: 'products-daily' },
  ];
  for (const store of STORES) {
    specs.push({ warm: campaignTabName_(store.id),           archive: campaignTabName_(store.id),           label: `${store.id}-campaigns` });
    specs.push({ warm: adsTabName_(store.id),                archive: adsTabName_(store.id),                label: `${store.id}-ads` });
    specs.push({ warm: ordersAttributionTabName_(store.id),  archive: ordersAttributionTabName_(store.id),  label: `${store.id}-orders-attribution` });
  }
  return specs;
}

/**
 * Public entry. Default is DRY-RUN — logs what *would* move without writing.
 * Pass {dryRun: false} (and ONLY after dry-running first) to actually move.
 *
 * @param {number} months   Rows with date < (today - months) are archived.
 *                          Recommend >= 18 (matches the dashboard fallback).
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=true]  If true, logs intended moves only.
 */
function archiveOlderThan(months, opts) {
  const dryRun = !opts || opts.dryRun !== false;
  const archiveId = getProp('archive.spreadsheet.id');
  if (!archiveId) {
    throw new Error(
      'Set Script Property "archive.spreadsheet.id" to the ID of an empty ' +
      'Google Sheets spreadsheet shared with the service-account. See ' +
      '05-04-PLAN.md user_setup section for the full procedure.'
    );
  }
  if (!Number.isFinite(months) || months <= 0) {
    throw new Error(`archiveOlderThan: invalid months=${months}, expected positive number`);
  }

  const warm = ensureSpreadsheet();
  const archive = SpreadsheetApp.openById(archiveId);
  const cutoff = monthsAgoStr_(months);
  Logger.log(`========== archive ${dryRun ? '[DRY-RUN]' : '[PRODUCTION]'} ==========`);
  Logger.log(`Cutoff: rows with date < ${cutoff} will be moved`);
  Logger.log(`Source: ${warm.getUrl()}`);
  Logger.log(`Target: ${archive.getUrl()}`);

  const specs = ARCHIVE_TAB_SPECS_();
  const summary = [];
  for (const spec of specs) {
    try {
      const moved = archiveTabRows_(warm, archive, spec, cutoff, dryRun);
      summary.push(`[${spec.label}] ${moved.count} rows (${moved.oldest || '—'} → ${moved.newest || '—'})`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      Logger.log(`[${spec.label}] ERROR: ${msg}`);
      summary.push(`[${spec.label}] ERROR: ${msg}`);
    }
  }
  Logger.log(`========== summary (${dryRun ? 'DRY-RUN' : 'PRODUCTION'}) ==========`);
  for (const line of summary) Logger.log(line);
  Logger.log(`Done. To execute for real after dry-run, call archiveOlderThan(${months}, {dryRun: false}).`);
}

/**
 * Moves rows with col-A date < cutoff from a warm tab to its archive
 * counterpart. Returns {count, oldest, newest} so the orchestrator can
 * print a summary. When dryRun=true, performs no writes and no deletes.
 */
function archiveTabRows_(warm, archive, spec, cutoff, dryRun) {
  const warmSheet = warm.getSheetByName(spec.warm);
  if (!warmSheet) {
    Logger.log(`[${spec.label}] warm tab missing — skipping`);
    return { count: 0, oldest: null, newest: null };
  }
  const lastRow = warmSheet.getLastRow();
  const lastCol = warmSheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) {
    Logger.log(`[${spec.label}] empty — skipping`);
    return { count: 0, oldest: null, newest: null };
  }

  const header = warmSheet.getRange(1, 1, 1, lastCol).getValues();
  const allRows = warmSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const toMove = [];
  const toKeep = [];
  let oldest = null, newest = null;
  for (const r of allRows) {
    const v = r[0];
    let key = null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      key = v.slice(0, 10);
    }
    // Preserve rows with unparseable dates — mirror the pattern used in
    // writeOrdersAttributionForDay etc. (WR5-02). Better to keep noise
    // than silently destroy a mid-format row.
    if (key && key < cutoff) {
      toMove.push(r);
      if (!oldest || key < oldest) oldest = key;
      if (!newest || key > newest) newest = key;
    } else {
      toKeep.push(r);
    }
  }

  Logger.log(`[${spec.label}] would move ${toMove.length} rows (oldest=${oldest || '—'} newest=${newest || '—'}); ${toKeep.length} stay`);

  if (dryRun || toMove.length === 0) {
    return { count: toMove.length, oldest, newest };
  }

  // 1) Ensure archive tab exists with same header.
  let archSheet = archive.getSheetByName(spec.archive);
  if (!archSheet) {
    archSheet = archive.insertSheet(spec.archive);
    archSheet.getRange(1, 1, 1, lastCol).setValues(header);
    archSheet.setFrozenRows(1);
  }
  // 2) Append moved rows to archive FIRST. Crash here = nothing lost.
  // Capture the first new-row index BEFORE appending so we can scope the
  // setNumberFormat call to ONLY the newly-appended rows (WR-07).
  // Previously this re-formatted col A from row 2 to last row on every
  // run — an O(archive-size) Sheets-API write that compounded across
  // monthly runs and contributed to the quota burn the Phase 5 trigger
  // split was supposed to avoid.
  const firstNewArchRow = archSheet.getLastRow() + 1;
  archSheet.getRange(firstNewArchRow, 1, toMove.length, lastCol).setValues(toMove);
  // Preserve date format on col A so archive reads parse correctly.
  archSheet.getRange(firstNewArchRow, 1, toMove.length, 1).setNumberFormat('yyyy-mm-dd');
  Logger.log(`[${spec.label}] appended ${toMove.length} rows to archive`);

  // 3) Rewrite warm with only the kept rows.
  warmSheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (toKeep.length > 0) {
    warmSheet.getRange(2, 1, toKeep.length, lastCol).setValues(toKeep);
    warmSheet.getRange(2, 1, toKeep.length, 1).setNumberFormat('yyyy-mm-dd');
  }
  Logger.log(`[${spec.label}] warm now has ${toKeep.length} data rows (was ${allRows.length})`);

  return { count: toMove.length, oldest, newest };
}

/** Menu helpers — dry-run + production for the standard 18-month retention. */
function archive18MonthsDryRun()    { archiveOlderThan(18, {dryRun: true});  }

/**
 * Production archive. The menu item sits one click away from the dry-run
 * item, so this wrapper gates the destructive call behind a confirmation
 * prompt that requires typing 'ARCHIVE' to proceed (WR-03). A misclick
 * on the menu item alone is no longer enough to trigger an irreversible
 * 6-to-18-month delete across 5 tabs.
 *
 * Falls through to archiveOlderThan only when:
 *   1. The OK button is pressed (Cancel returns silently), AND
 *   2. The typed confirmation matches 'ARCHIVE' exactly.
 */
function archive18MonthsProduction() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'ארכוב לפרודקשן',
    'פעולה הרסנית — מעבירה ~6-18 חודשים של שורות מ-5 טאבים. הזן ARCHIVE לאישור.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  if (res.getResponseText().trim() !== 'ARCHIVE') {
    ui.alert('הפעולה בוטלה — לא הוזנה אישור תקין (נדרש: ARCHIVE).');
    return;
  }
  archiveOlderThan(18, {dryRun: false});
}

// ============================================================================

function notifyError_(dateStr, message) {
  try {
    const configured = getProp('notification.email');
    const owner = (function () {
      try { return Session.getEffectiveUser().getEmail(); } catch (_) { return ''; }
    })();
    const active = (function () {
      try { return Session.getActiveUser().getEmail(); } catch (_) { return ''; }
    })();
    const email = configured || owner || active;
    if (!email) {
      Logger.log('notifyError_: no recipient resolved (set Script Property "notification.email").');
      return;
    }
    const errorCount = (message.match(/^\[/gm) || []).length || 'יש';
    const scriptUrl = (function () {
      try { return `https://script.google.com/home/projects/${ScriptApp.getScriptId()}/edit`; }
      catch (_) { return ''; }
    })();
    const body =
      `${message}\n\n` +
      `——————————\n` +
      `דיווח אוטומטי מ-ROAS Tracker · ${dateStr}\n` +
      (scriptUrl ? `Apps Script: ${scriptUrl}\n` : '') +
      `\n` +
      `אם המייל הזה מטריד, שנה את הנמען או כבה אותו:\n` +
      `Script Properties → notification.email → רוקן את הערך כדי להפסיק לקבל.`;
    MailApp.sendEmail({
      to: email,
      subject: `ROAS Tracker · ${errorCount} שגיאות בעדכון ${dateStr}`,
      body,
    });
    Logger.log(`notifyError_: notification sent to ${email}`);
  } catch (e) {
    Logger.log(`notifyError_: failed to send (${e && e.message ? e.message : e})`);
  }
}

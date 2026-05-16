/**
 * MetaAds.gs - הוצאות פרסום מ-Meta Ads (פייסבוק/אינסטגרם).
 *
 * נדרש:
 *   - {storeId}.meta.adAccountId        (מספר Ad Account ללא הקידומת act_)
 *   - meta.accessToken                  (System User token עם הרשאת ads_read)
 *     או
 *   - {storeId}.meta.accessToken        (System User token ספציפי לחנות זו -
 *                                        משמש כשהחשבון בעסק (Business) נפרד.
 *                                        אם מוגדר, גובר על meta.accessToken)
 *
 * ה-API מחזיר את ה-spend במטבע של חשבון הפרסום. עבור החנויות האלו - ILS.
 */

/**
 * שולף נתוני ad-set מ-Meta ליום נתון, עם פרטי הקמפיין כל אחד.
 * מחזיר מערך אובייקטים אחיד שמתאים לכתיבה לטאב הקמפיינים.
 */
function getMetaAdSetInsights(storeId, dateStr) {
  const token = getProp(`${storeId}.meta.accessToken`) || getProp('meta.accessToken');
  if (!token) {
    throw new Error(
      `חסר טוקן Meta עבור ${storeId}. הגדר ${storeId}.meta.accessToken או meta.accessToken.`
    );
  }
  const adAccountId = requireProp(`${storeId}.meta.adAccountId`).replace(/^act_/, '');

  const timeRange = JSON.stringify({ since: dateStr, until: dateStr });
  const fields = 'campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,action_values,account_currency';
  let url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
            `?fields=${fields}` +
            `&time_range=${encodeURIComponent(timeRange)}` +
            `&level=adset` +
            `&limit=500` +
            `&access_token=${encodeURIComponent(token)}`;

  const out = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = fetchWithRetry_(url, { method: 'get', muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error(`Meta adsets ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const rows = (body && body.data) || [];
    for (const r of rows) {
      const spend = parseFloat(r.spend || 0);
      const impressions = parseInt(r.impressions || 0, 10);
      // דלג על ad sets שלא היו פעילים ביום הזה (אין spend וגם אין חשיפות).
      // קוצץ דרסטית את כמות השורות (מ-334 ל-~30-50 בפרקטיקה).
      if (spend === 0 && impressions === 0) continue;
      const conv = extractMetaPurchases_(r);
      out.push({
        campaignId: r.campaign_id || '',
        campaignName: r.campaign_name || '',
        adSetId: r.adset_id || '',
        adSetName: r.adset_name || '',
        spend: spend,
        currency: r.account_currency || 'ILS',
        impressions: impressions,
        clicks: parseInt(r.clicks || 0, 10),
        conversions: conv.count,
        conversionValue: conv.value,
      });
    }
    url = (body.paging && body.paging.next) || null;
    safety++;
  }
  Logger.log(`Meta adsets ${storeId} ${dateStr}: ${out.length} ad sets`);
  return out;
}

function extractMetaPurchases_(insightsRow) {
  const actions = insightsRow.actions || [];
  const values = insightsRow.action_values || [];
  // עדיפות ל-omni_purchase שכולל גם offline; נופלים ל-purchase או fb_pixel_purchase אם אין.
  const types = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
  function pick(arr) {
    for (const t of types) {
      const found = arr.find(a => a.action_type === t);
      if (found) return parseFloat(found.value || 0);
    }
    return 0;
  }
  return { count: pick(actions), value: pick(values) };
}

function getMetaSpend(storeId, dateStr) {
  const token = getProp(`${storeId}.meta.accessToken`) || getProp('meta.accessToken');
  if (!token) {
    throw new Error(
      `חסר טוקן Meta עבור ${storeId}. הגדר אחד מהבאים ב-Script Properties:\n` +
      `  1. ${storeId}.meta.accessToken  (טוקן ספציפי לחנות זו)\n` +
      `  2. meta.accessToken              (טוקן גלובלי לכל החנויות)`
    );
  }
  const adAccountId = requireProp(`${storeId}.meta.adAccountId`).replace(/^act_/, '');

  const timeRange = JSON.stringify({ since: dateStr, until: dateStr });
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
              `?fields=spend,account_currency` +
              `&time_range=${encodeURIComponent(timeRange)}` +
              `&level=account` +
              `&access_token=${encodeURIComponent(token)}`;

  const res = fetchWithRetry_(url, { method: 'get', muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`Meta ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
  }
  const body = JSON.parse(res.getContentText());
  const rows = (body && body.data) || [];
  if (rows.length === 0) {
    Logger.log(`Meta ${storeId} ${dateStr}: no data`);
    return { spend: 0, currency: 'ILS' };
  }
  const spend = parseFloat(rows[0].spend || 0);
  const currency = rows[0].account_currency || 'ILS';
  Logger.log(`Meta ${storeId} ${dateStr}: spend=${spend} ${currency}`);
  return { spend, currency };
}

/**
 * שולף את התקציב היומי / לכל-החיים של כל הקמפיינים וה-ad-sets בחשבון.
 *
 * Meta API מחזיר תקציבים ביחידות מינוריות של המטבע (cents/agorot) כמחרוזות.
 * דוגמה: "5000" בחשבון ILS = ₪50. צריך לחלק ב-100 כדי לקבל ערך אמיתי במטבע
 * החשבון, ואז להמיר ל-CAD לפי FX היומי.
 *
 * הבחנת CBO/ABO:
 *   - אם daily_budget או lifetime_budget של הקמפיין > 0 → CBO (קמפיין הוא
 *     בעל התקציב, אין ל-ad-sets שלו תקציבים נפרדים).
 *   - אם שניהם 0/null וה-ad-sets יש להם תקציבים → ABO (כל ad-set הוא בעל
 *     תקציב משלו).
 *
 * החזרה:
 *   {
 *     currency: 'ILS' | 'USD' | ...,
 *     campaigns: Map<campaignId, { dailyBudget, lifetimeBudget, bidStrategy }>,
 *     adSets:    Map<adSetId,    { dailyBudget, lifetimeBudget, campaignId }>,
 *   }
 *
 * הערכים daily/lifetime כבר חלוקים ב-100 (כלומר במטבע מלא, לא ב-cents).
 */
function getMetaBudgets(storeId) {
  const token = getProp(`${storeId}.meta.accessToken`) || getProp('meta.accessToken');
  if (!token) {
    throw new Error(`חסר טוקן Meta עבור ${storeId}.`);
  }
  const adAccountId = requireProp(`${storeId}.meta.adAccountId`).replace(/^act_/, '');

  // ---- account currency (one shot) -----------------------------------------
  let currency = 'ILS';
  try {
    const acctUrl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}` +
                    `?fields=currency&access_token=${encodeURIComponent(token)}`;
    const acctRes = fetchWithRetry_(acctUrl, { method: 'get', muteHttpExceptions: true });
    if (acctRes.getResponseCode() === 200) {
      const acctBody = JSON.parse(acctRes.getContentText());
      currency = acctBody.currency || 'ILS';
    }
  } catch (_) {
    // Fall back to ILS — the budget will still get FX-converted later, so a
    // wrong currency tag is conservative but not catastrophic.
  }

  function toMajor(rawStr) {
    const n = parseFloat(rawStr || 0);
    return Number.isFinite(n) ? n / 100 : 0;
  }

  // ---- campaigns ------------------------------------------------------------
  const campaigns = {};
  let curl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/campaigns` +
             `?fields=id,daily_budget,lifetime_budget,bid_strategy,status,effective_status` +
             `&limit=500&access_token=${encodeURIComponent(token)}`;
  let safety = 0;
  while (curl && safety < 50) {
    const res = fetchWithRetry_(curl, { method: 'get', muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log(`Meta campaigns budgets ${storeId} failed (${res.getResponseCode()}): ${res.getContentText()}`);
      break;
    }
    const body = JSON.parse(res.getContentText());
    for (const c of (body.data || [])) {
      campaigns[c.id] = {
        dailyBudget: toMajor(c.daily_budget),
        lifetimeBudget: toMajor(c.lifetime_budget),
        bidStrategy: c.bid_strategy || '',
        status: c.effective_status || c.status || '',
      };
    }
    curl = (body.paging && body.paging.next) || null;
    safety++;
  }

  // ---- ad-sets --------------------------------------------------------------
  const adSets = {};
  let aurl = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/adsets` +
             `?fields=id,campaign_id,daily_budget,lifetime_budget,status,effective_status` +
             `&limit=500&access_token=${encodeURIComponent(token)}`;
  safety = 0;
  while (aurl && safety < 50) {
    const res = fetchWithRetry_(aurl, { method: 'get', muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log(`Meta adsets budgets ${storeId} failed (${res.getResponseCode()}): ${res.getContentText()}`);
      break;
    }
    const body = JSON.parse(res.getContentText());
    for (const a of (body.data || [])) {
      adSets[a.id] = {
        dailyBudget: toMajor(a.daily_budget),
        lifetimeBudget: toMajor(a.lifetime_budget),
        campaignId: a.campaign_id || '',
        status: a.effective_status || a.status || '',
      };
    }
    aurl = (body.paging && body.paging.next) || null;
    safety++;
  }

  Logger.log(`Meta budgets ${storeId}: ${Object.keys(campaigns).length} campaigns / ${Object.keys(adSets).length} adsets · currency=${currency}`);
  return { currency, campaigns, adSets };
}

/**
 * שולף את כל המודעות (ads) של חשבון המודעות ביום נתון, ברמת המודעה.
 *
 * זה ה-drilldown העמוק ביותר ב-Meta API. בניגוד ל-getMetaAdSetInsights
 * (שמחזיר שורה לכל ad-set), הקריאה הזאת מחזירה שורה לכל ad בודד בתוך
 * ה-ad-set, כך שה-dashboard יכול להציג איזה creative בתוך ה-ad-set
 * מבצע טוב/רע ולתת focus לאופטימיזציה.
 *
 * הסתננות:
 *   - מדלגים על ads שלא היו פעילים ביום (spend=0 וגם impressions=0) — מצמצם
 *     מאות שורות שאין בהן מידע.
 *
 * Conversions:
 *   - אותה לוגיקת extractMetaPurchases_ כמו ב-ad-set fetcher.
 */
function getMetaAdInsights(storeId, dateStr) {
  const token = getProp(`${storeId}.meta.accessToken`) || getProp('meta.accessToken');
  if (!token) {
    throw new Error(`חסר טוקן Meta עבור ${storeId}.`);
  }
  const adAccountId = requireProp(`${storeId}.meta.adAccountId`).replace(/^act_/, '');

  const timeRange = JSON.stringify({ since: dateStr, until: dateStr });
  const fields = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,' +
                 'spend,impressions,clicks,actions,action_values,account_currency';
  let url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
            `?fields=${fields}` +
            `&time_range=${encodeURIComponent(timeRange)}` +
            `&level=ad` +
            `&limit=500` +
            `&access_token=${encodeURIComponent(token)}`;

  const out = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = fetchWithRetry_(url, { method: 'get', muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error(`Meta ads ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const rows = (body && body.data) || [];
    for (const r of rows) {
      const spend = parseFloat(r.spend || 0);
      const impressions = parseInt(r.impressions || 0, 10);
      if (spend === 0 && impressions === 0) continue;
      const conv = extractMetaPurchases_(r);
      out.push({
        campaignId: r.campaign_id || '',
        campaignName: r.campaign_name || '',
        adSetId: r.adset_id || '',
        adSetName: r.adset_name || '',
        adId: r.ad_id || '',
        adName: r.ad_name || '',
        spend: spend,
        currency: r.account_currency || 'ILS',
        impressions: impressions,
        clicks: parseInt(r.clicks || 0, 10),
        conversions: conv.count,
        conversionValue: conv.value,
      });
    }
    url = (body.paging && body.paging.next) || null;
    safety++;
  }
  Logger.log(`Meta ads ${storeId} ${dateStr}: ${out.length} ads`);
  return out;
}

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
      const conv = extractMetaPurchases_(r);
      out.push({
        campaignId: r.campaign_id || '',
        campaignName: r.campaign_name || '',
        adSetId: r.adset_id || '',
        adSetName: r.adset_name || '',
        spend: parseFloat(r.spend || 0),
        currency: r.account_currency || 'ILS',
        impressions: parseInt(r.impressions || 0, 10),
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

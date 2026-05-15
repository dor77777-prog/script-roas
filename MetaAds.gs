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

function getMetaSpend(storeId, dateStr) {
  const token = getProp(`${storeId}.meta.accessToken`) || requireProp('meta.accessToken');
  const adAccountId = requireProp(`${storeId}.meta.adAccountId`).replace(/^act_/, '');

  const timeRange = JSON.stringify({ since: dateStr, until: dateStr });
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/insights` +
              `?fields=spend,account_currency` +
              `&time_range=${encodeURIComponent(timeRange)}` +
              `&level=account` +
              `&access_token=${encodeURIComponent(token)}`;

  const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
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

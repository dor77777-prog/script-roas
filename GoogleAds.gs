/**
 * GoogleAds.gs - הוצאות פרסום מ-Google Ads (רק עבור uzoshop).
 *
 * נדרש:
 *   - googleads.developerToken      (Developer token של חשבון Google Ads)
 *   - googleads.clientId            (OAuth Client ID)
 *   - googleads.clientSecret        (OAuth Client Secret)
 *   - googleads.refreshToken        (Refresh Token שהתקבל בעת ה-OAuth)
 *   - googleads.loginCustomerId     (אופציונלי - אם החשבון תחת MCC, ללא מקפים)
 *   - {storeId}.googleads.customerId (מספר חשבון Google Ads של החנות, ללא מקפים)
 *
 * cost_micros מוחזר במיליוניות של המטבע של החשבון (CAD).
 */

function getGoogleAdsSpend(storeId, dateStr) {
  const customerId = requireProp(`${storeId}.googleads.customerId`).replace(/-/g, '');
  const developerToken = requireProp('googleads.developerToken');
  const loginCustomerId = getProp('googleads.loginCustomerId', '').replace(/-/g, '');

  const accessToken = getGoogleAdsAccessToken_();

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const query = `SELECT metrics.cost_micros, customer.currency_code FROM customer WHERE segments.date = '${dateStr}'`;

  const headers = {
    Authorization: 'Bearer ' + accessToken,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers,
    payload: JSON.stringify({ query, pageSize: 1000 }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`Google Ads ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
  }
  const body = JSON.parse(res.getContentText());
  const results = (body && body.results) || [];
  let micros = 0;
  let currency = 'CAD';
  for (const r of results) {
    micros += parseInt((r.metrics && r.metrics.costMicros) || 0, 10);
    if (r.customer && r.customer.currencyCode) currency = r.customer.currencyCode;
  }
  const spend = micros / 1_000_000;
  Logger.log(`GoogleAds ${storeId} ${dateStr}: spend=${spend} ${currency}`);
  return { spend, currency };
}

function getGoogleAdsAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('googleads.accessToken');
  if (cached) return cached;

  const clientId = requireProp('googleads.clientId');
  const clientSecret = requireProp('googleads.clientSecret');
  const refreshToken = requireProp('googleads.refreshToken');

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`Google Ads token refresh failed: ${res.getContentText()}`);
  }
  const data = JSON.parse(res.getContentText());
  const ttl = Math.max(60, (data.expires_in || 3600) - 120);
  cache.put('googleads.accessToken', data.access_token, ttl);
  return data.access_token;
}

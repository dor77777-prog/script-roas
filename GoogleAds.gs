/**
 * GoogleAds.gs - Hotzaot Google Ads (uzoshop only).
 *
 * Required Script Properties:
 *   - googleads.developerToken
 *   - googleads.clientId
 *   - googleads.clientSecret
 *   - googleads.refreshToken
 *   - googleads.loginCustomerId   (optional, for MCC accounts, no dashes)
 *   - {storeId}.googleads.customerId  (no dashes)
 *
 * cost_micros is returned in millionths of the account currency (CAD).
 */

/**
 * שולף נתוני ad-group מ-Google Ads ליום נתון, עם פרטי הקמפיין כל אחד.
 * מחזיר מערך אובייקטים אחיד עם getMetaAdSetInsights (Google's "ad group" = Meta's "ad set").
 */
function getGoogleAdsAdGroupInsights(storeId, dateStr) {
  var customerId = requireProp(storeId + '.googleads.customerId').replace(/-/g, '');
  var developerToken = requireProp('googleads.developerToken');
  var loginCustomerId = getProp('googleads.loginCustomerId', '').replace(/-/g, '');

  var accessToken = getGoogleAdsAccessToken_();

  var url = 'https://googleads.googleapis.com/' + GOOGLE_ADS_API_VERSION +
            '/customers/' + customerId + '/googleAds:search';
  var query =
    "SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, " +
    "metrics.cost_micros, metrics.impressions, metrics.clicks, " +
    "metrics.conversions, metrics.conversions_value, customer.currency_code " +
    "FROM ad_group WHERE segments.date = '" + dateStr + "'";

  var headers = {
    'Authorization': 'Bearer ' + accessToken,
    'developer-token': developerToken,
    'Content-Type': 'application/json'
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  var res = fetchWithRetry_(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Google Ads ad groups ' + storeId + ' ' + dateStr + ' failed (' + code + '): ' + res.getContentText());
  }
  var body = JSON.parse(res.getContentText());
  var results = (body && body.results) || [];
  var out = [];
  var currency = 'CAD';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.customer && r.customer.currencyCode) currency = r.customer.currencyCode;
    var camp = r.campaign || {};
    var ag = r.adGroup || {};
    var m = r.metrics || {};
    out.push({
      campaignId: camp.id || '',
      campaignName: camp.name || '',
      adSetId: ag.id || '',
      adSetName: ag.name || '',
      spend: parseInt(m.costMicros || 0, 10) / 1000000,
      currency: currency,
      impressions: parseInt(m.impressions || 0, 10),
      clicks: parseInt(m.clicks || 0, 10),
      conversions: parseFloat(m.conversions || 0),
      conversionValue: parseFloat(m.conversionsValue || 0),
    });
  }
  Logger.log('GoogleAds ad groups ' + storeId + ' ' + dateStr + ': ' + out.length + ' ad groups');
  return out;
}

function getGoogleAdsSpend(storeId, dateStr) {
  var customerId = requireProp(storeId + '.googleads.customerId').replace(/-/g, '');
  var developerToken = requireProp('googleads.developerToken');
  var loginCustomerId = getProp('googleads.loginCustomerId', '').replace(/-/g, '');

  var accessToken = getGoogleAdsAccessToken_();

  var url = 'https://googleads.googleapis.com/' + GOOGLE_ADS_API_VERSION +
            '/customers/' + customerId + '/googleAds:search';
  var query = "SELECT metrics.cost_micros, customer.currency_code FROM customer WHERE segments.date = '" + dateStr + "'";

  var headers = {
    'Authorization': 'Bearer ' + accessToken,
    'developer-token': developerToken,
    'Content-Type': 'application/json'
  };
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  var res = fetchWithRetry_(url, {
    method: 'post',
    headers: headers,
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Google Ads ' + storeId + ' ' + dateStr + ' failed (' + code + '): ' + res.getContentText());
  }
  var body = JSON.parse(res.getContentText());
  var results = (body && body.results) || [];
  var micros = 0;
  var currency = 'CAD';
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    micros += parseInt((r.metrics && r.metrics.costMicros) || 0, 10);
    if (r.customer && r.customer.currencyCode) {
      currency = r.customer.currencyCode;
    }
  }
  var spend = micros / 1000000;
  Logger.log('GoogleAds ' + storeId + ' ' + dateStr + ': spend=' + spend + ' ' + currency);
  return { spend: spend, currency: currency };
}

function getGoogleAdsAccessToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('googleads.accessToken');
  if (cached) {
    return cached;
  }

  var clientId = requireProp('googleads.clientId');
  var clientSecret = requireProp('googleads.clientSecret');
  var refreshToken = requireProp('googleads.refreshToken');

  var res = fetchWithRetry_('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Google Ads token refresh failed: ' + res.getContentText());
  }
  var data = JSON.parse(res.getContentText());
  var ttl = Math.max(60, (data.expires_in || 3600) - 120);
  cache.put('googleads.accessToken', data.access_token, ttl);
  return data.access_token;
}

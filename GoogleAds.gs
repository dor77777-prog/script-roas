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

  var res = UrlFetchApp.fetch(url, {
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

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
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

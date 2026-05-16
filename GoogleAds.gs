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
/**
 * Returns one row per (campaign × ad_group). Two queries run in sequence:
 *  1. ad_group level — works for Search/Display campaigns
 *  2. campaign level — used as a fallback for SHOPPING / Performance Max
 *     campaigns, where Google reports metrics only at the campaign level
 *     and ad_group rows come back with all metrics = 0.
 *
 * For each campaign:
 *  - If ad_group rows have any real activity (spend OR impressions > 0) we
 *    keep those rows.
 *  - Otherwise we synthesize a single row from the campaign-level metrics,
 *    with adSetName = "(שופינג)" to signal that the breakdown isn't
 *    available at finer grain.
 */
function getGoogleAdsAdGroupInsights(storeId, dateStr) {
  var customerId = requireProp(storeId + '.googleads.customerId').replace(/-/g, '');
  var developerToken = requireProp('googleads.developerToken');
  var loginCustomerId = getProp('googleads.loginCustomerId', '').replace(/-/g, '');
  var accessToken = getGoogleAdsAccessToken_();

  var url = 'https://googleads.googleapis.com/' + GOOGLE_ADS_API_VERSION +
            '/customers/' + customerId + '/googleAds:search';
  var headers = {
    'Authorization': 'Bearer ' + accessToken,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  function runQuery_(query) {
    var res = fetchWithRetry_(url, {
      method: 'post',
      headers: headers,
      payload: JSON.stringify({ query: query }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('Google Ads query (' + code + ') for ' + storeId + ' ' + dateStr + ': ' + res.getContentText());
    }
    var body = JSON.parse(res.getContentText());
    return (body && body.results) || [];
  }

  // ----- 1) ad_group query (granular when available)
  var adGroupQuery =
    "SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, " +
    "metrics.cost_micros, metrics.impressions, metrics.clicks, " +
    "metrics.conversions, metrics.conversions_value, customer.currency_code " +
    "FROM ad_group WHERE segments.date = '" + dateStr + "'";
  var adGroupResults = runQuery_(adGroupQuery);

  // ----- 2) campaign query (always-accurate totals, used for shopping fallback)
  var campaignQuery =
    "SELECT campaign.id, campaign.name, " +
    "metrics.cost_micros, metrics.impressions, metrics.clicks, " +
    "metrics.conversions, metrics.conversions_value, customer.currency_code " +
    "FROM campaign WHERE segments.date = '" + dateStr + "'";
  var campaignResults = runQuery_(campaignQuery);

  // Sum ad-group activity per campaign to decide whether ad-group rows are
  // meaningful or whether we should fall back to campaign-level.
  var currency = 'CAD';
  var adGroupByCampaign = {};   // campaignId -> { rows: [...], totalActivity: number }
  for (var i = 0; i < adGroupResults.length; i++) {
    var r = adGroupResults[i];
    if (r.customer && r.customer.currencyCode) currency = r.customer.currencyCode;
    var camp = r.campaign || {};
    var ag = r.adGroup || {};
    var m = r.metrics || {};
    var cid = String(camp.id || '');
    if (!adGroupByCampaign[cid]) adGroupByCampaign[cid] = { rows: [], activity: 0 };
    var spend = parseInt(m.costMicros || 0, 10) / 1000000;
    var imps = parseInt(m.impressions || 0, 10);
    adGroupByCampaign[cid].activity += spend + imps;
    adGroupByCampaign[cid].rows.push({
      campaignId: cid,
      campaignName: camp.name || '',
      adSetId: ag.id || '',
      adSetName: ag.name || '',
      spend: spend,
      currency: currency,
      impressions: imps,
      clicks: parseInt(m.clicks || 0, 10),
      conversions: parseFloat(m.conversions || 0),
      conversionValue: parseFloat(m.conversionsValue || 0),
    });
  }

  var out = [];
  var fallbackCount = 0;
  for (var j = 0; j < campaignResults.length; j++) {
    var cr = campaignResults[j];
    if (cr.customer && cr.customer.currencyCode) currency = cr.customer.currencyCode;
    var ccamp = cr.campaign || {};
    var cm = cr.metrics || {};
    var ccid = String(ccamp.id || '');
    var bucket = adGroupByCampaign[ccid];
    if (bucket && bucket.activity > 0) {
      // Granular ad_group data is available — push those rows.
      for (var k = 0; k < bucket.rows.length; k++) out.push(bucket.rows[k]);
    } else {
      // Shopping / PMax / similar — fall back to a synthesized campaign-level row.
      var cSpend = parseInt(cm.costMicros || 0, 10) / 1000000;
      var cImps = parseInt(cm.impressions || 0, 10);
      if (cSpend === 0 && cImps === 0) continue; // truly inactive that day
      out.push({
        campaignId: ccid,
        campaignName: ccamp.name || '',
        adSetId: ccid,               // reuse campaign id since there's no ad-group
        adSetName: '(רמת קמפיין)',     // signals to the user this is aggregated
        spend: cSpend,
        currency: currency,
        impressions: cImps,
        clicks: parseInt(cm.clicks || 0, 10),
        conversions: parseFloat(cm.conversions || 0),
        conversionValue: parseFloat(cm.conversionsValue || 0),
      });
      fallbackCount++;
    }
  }

  Logger.log('GoogleAds ad groups ' + storeId + ' ' + dateStr +
             ': ' + out.length + ' rows (' + fallbackCount + ' campaign-level fallbacks)');
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

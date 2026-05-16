/**
 * Shopify.gs - שליפת הכנסות יומיות מ-Shopify Admin API.
 *
 * נדרש לכל חנות:
 *   - {storeId}.shopify.domain         (לדוגמה: my-shop.myshopify.com)
 *   - {storeId}.shopify.token          (Admin API access token, shpat_...)
 *
 * אם החנות הוקמה דרך Shopify Dev Dashboard החדש ואין כפתור "Reveal token once",
 * השג את הטוקן ע"י Client Credentials Grant - ראה bootstrapShopifyToken().
 * נדרש במקרה הזה גם:
 *   - {storeId}.shopify.clientId       (מהאפליקציה ב-Dev Dashboard)
 *   - {storeId}.shopify.clientSecret   (מהאפליקציה ב-Dev Dashboard)
 *
 * אנו סוכמים את current_total_price של ההזמנות שנוצרו בחלון היום (שעון ישראל),
 * למעט הזמנות test ו-voided. current_total_price כבר מנכה החזרים על ההזמנה.
 */

function getShopifyRevenue(storeId, dateStr) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token  = requireProp(`${storeId}.shopify.token`);

  const dayStart = `${dateStr}T00:00:00+03:00`;
  const dayEnd   = `${nextDayStr_(dateStr)}T00:00:00+03:00`;

  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
            `?status=any&financial_status=any&limit=250` +
            `&created_at_min=${encodeURIComponent(dayStart)}` +
            `&created_at_max=${encodeURIComponent(dayEnd)}` +
            `&fields=id,current_total_price,financial_status,test`;

  let total = 0;
  let count = 0;
  let safety = 0;

  while (url && safety < 50) {
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) {
      Utilities.sleep(2000);
      safety++;
      continue;
    }
    if (code !== 200) {
      throw new Error(`Shopify ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const orders = (body && body.orders) || [];
    for (const o of orders) {
      if (o.test) continue;
      if (o.financial_status === 'voided') continue;
      total += parseFloat(o.current_total_price || 0);
      count++;
    }
    const link = res.getHeaders()['Link'] || res.getHeaders()['link'] || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    safety++;
  }

  Logger.log(`Shopify ${storeId} ${dateStr}: ${count} orders, total=${total.toFixed(2)} CAD`);
  return total;
}

/**
 * משיג טוקן Admin API דרך Client Credentials Grant (לאפליקציות שהוקמו
 * דרך Dev Dashboard ואין להן "Reveal token once"). הטוקן שמוחזר ארוך-תוקף
 * ולא פג, אז קוראים לזה פעם אחת ושומרים ל-Script Properties.
 *
 * דורש שיוגדרו מראש:
 *   {storeId}.shopify.domain
 *   {storeId}.shopify.clientId
 *   {storeId}.shopify.clientSecret
 *
 * אחרי הצלחה, נכתוב את {storeId}.shopify.token אוטומטית.
 */
function bootstrapShopifyToken(storeId) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const clientId = requireProp(`${storeId}.shopify.clientId`);
  const clientSecret = requireProp(`${storeId}.shopify.clientSecret`);

  const url = `https://${domain}/admin/oauth/access_token`;
  const res = fetchWithRetry_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`Shopify bootstrap ${storeId} failed (${code}): ${res.getContentText()}`);
  }
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error(`Shopify bootstrap ${storeId}: missing access_token in response: ${res.getContentText()}`);
  }
  setProp(`${storeId}.shopify.token`, data.access_token);
  Logger.log(`Shopify ${storeId}: token saved (scope=${data.scope || 'n/a'})`);
  return data.access_token;
}

/** מקבל טוקנים לכל החנויות ב-Dev Dashboard flow. */
function bootstrapAllShopifyTokens() {
  for (const store of STORES) {
    try {
      bootstrapShopifyToken(store.id);
    } catch (e) {
      Logger.log(`Skip ${store.id}: ${e && e.message ? e.message : e}`);
    }
  }
}

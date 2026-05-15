/**
 * Shopify.gs - שליפת הכנסות יומיות מ-Shopify Admin API.
 *
 * נדרש לכל חנות:
 *   - {storeId}.shopify.domain  (לדוגמה: my-shop.myshopify.com)
 *   - {storeId}.shopify.token   (Admin API access token מ-Custom App)
 *
 * אנו סוכמים את current_total_price של כל ההזמנות שנוצרו בחלון היום (לפי שעון ישראל),
 * למעט הזמנות test ו-voided. current_total_price כבר מנכה החזרים שעוּדכנו בהזמנה.
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
    const res = UrlFetchApp.fetch(url, {
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

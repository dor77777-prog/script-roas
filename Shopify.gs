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
 * שולף breakdown של מכירות לפי מוצר ליום נתון.
 * עובר על כל ההזמנות של היום, מקבץ line_items לפי product_id, ומחזיר
 * מערך אובייקטים: {productId, productTitle, units, revenueCad,
 *                  netRevenueCad, orders}.
 *
 * units         = סך הכמות שנמכרה (sum of quantity)
 * revenueCad    = הכנסה ברוטו: sum(price × quantity), לפני הנחות והחזרות
 * netRevenueCad = הכנסה נטו: revenueCad − line_item.total_discount − refunds
 *                 (refunds נשלפים מ-order.refunds[].refund_line_items[].subtotal)
 * orders        = מספר ההזמנות הייחודיות שהכילו את המוצר
 *
 * משתמש באותו endpoint של getShopifyRevenue אבל מבקש את line_items.
 * Shopify מחזיר prices במטבע החנות (CAD בכל 3 החנויות) — אין צורך בהמרה.
 *
 * Revenue ברמת המוצר = sum(quantity × price) ללא ניכוי הנחות (gross).
 * זה לא תואם בהכרח לסכום החנות (שמשתמש ב-current_total_price אחרי הנחות/החזרים),
 * אז יש להתייחס לזה כ-"מכירה ברוטו לפני הנחות".
 */
function getShopifyProductSalesForDay(storeId, dateStr) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = requireProp(`${storeId}.shopify.token`);

  const dayStart = `${dateStr}T00:00:00+03:00`;
  const dayEnd = `${nextDayStr_(dateStr)}T00:00:00+03:00`;

  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
            `?status=any&financial_status=any&limit=250` +
            `&created_at_min=${encodeURIComponent(dayStart)}` +
            `&created_at_max=${encodeURIComponent(dayEnd)}` +
            `&fields=id,financial_status,test,line_items,refunds`;

  // productId -> {productId, productTitle, units, revenueCad, netRevenueCad,
  //               orderIds: {orderId: 1}}
  const byProduct = {};
  let safety = 0;

  while (url && safety < 50) {
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) { Utilities.sleep(2000); safety++; continue; }
    if (code !== 200) {
      throw new Error(`Shopify product sales ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const orders = (body && body.orders) || [];
    for (const o of orders) {
      if (o.test) continue;
      if (o.financial_status === 'voided') continue;
      const orderId = String(o.id || '');

      // Build a per-line-item refund map for this order so we can subtract
      // refunds at the line-item granularity (a partial refund of one product
      // shouldn't shrink another product's revenue).
      const refundByLineId = {};
      for (const refund of (o.refunds || [])) {
        for (const rli of (refund.refund_line_items || [])) {
          const liId = String(rli.line_item_id || '');
          if (!liId) continue;
          const amount = parseFloat(rli.subtotal || rli.total || 0);
          refundByLineId[liId] = (refundByLineId[liId] || 0) + amount;
        }
      }

      const items = o.line_items || [];
      for (const li of items) {
        const pid = String(li.product_id || ''); // could be empty for custom items
        const key = pid || `custom:${li.title || 'Unknown'}`;
        const title = li.title || li.name || 'Unknown';
        const qty = parseInt(li.quantity || 0, 10);
        const price = parseFloat(li.price || 0);
        const gross = qty * price;

        // Shopify's `total_discount` aggregates all discounts applied to this
        // line item (line-level + order-level allocated portion).
        const lineDiscount = parseFloat(li.total_discount || 0);
        const lineRefund = refundByLineId[String(li.id || '')] || 0;
        const net = Math.max(0, gross - lineDiscount - lineRefund);

        if (!byProduct[key]) {
          byProduct[key] = {
            productId: pid,
            productTitle: title,
            units: 0,
            revenueCad: 0,
            netRevenueCad: 0,
            // Tracked as keys of a plain object since GAS V8 is fine with Sets
            // but plain object lookups are cheaper here.
            orderIds: {},
          };
        }
        byProduct[key].units += qty;
        byProduct[key].revenueCad += gross;
        byProduct[key].netRevenueCad += net;
        if (orderId) byProduct[key].orderIds[orderId] = 1;
      }
    }
    const link = res.getHeaders()['Link'] || res.getHeaders()['link'] || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    safety++;
  }

  const out = Object.values(byProduct)
    .map(p => ({
      productId: p.productId,
      productTitle: p.productTitle,
      units: p.units,
      revenueCad: p.revenueCad,
      netRevenueCad: p.netRevenueCad,
      orders: Object.keys(p.orderIds).length,
    }))
    .sort((a, b) => b.units - a.units);
  const totalUnits = out.reduce((s, p) => s + p.units, 0);
  const totalOrders = out.reduce((s, p) => s + p.orders, 0);
  const totalGross = out.reduce((s, p) => s + p.revenueCad, 0);
  const totalNet = out.reduce((s, p) => s + p.netRevenueCad, 0);
  Logger.log(`Shopify products ${storeId} ${dateStr}: ${out.length} products, ${totalUnits} units / ${totalOrders} order-product pairs, gross=${totalGross.toFixed(2)} net=${totalNet.toFixed(2)} CAD`);
  return out;
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

/**
 * שולף את שם תוכנית ה-Shopify של החנות דרך GraphQL Admin API.
 *
 * Shopify לא חושפת את עלות התוכנית דרך ה-API (Billing API מוגבל ל-app charges
 * של האפליקציה שעשתה את הקריאה — לא רואים את חיוב ה-plan המרכזי). מה שכן זמין
 * זה `shop.plan.displayName`, ערכים כמו "Basic Shopify" / "Shopify" /
 * "Advanced Shopify" / "Shopify Plus" / "Starter". הצד של ה-dashboard עושה
 * mapping בין displayName למחיר USD סטטי.
 *
 * החזרה: { displayName, partnerDevelopment, shopifyPlus } או null אם נכשל.
 */
function getShopifyPlan(storeId) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = requireProp(`${storeId}.shopify.token`);

  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const query = `{
    shop {
      name
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
    }
  }`;

  const res = fetchWithRetry_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log(`Shopify plan ${storeId} failed (${code}): ${res.getContentText()}`);
    return null;
  }
  const body = JSON.parse(res.getContentText());
  const plan = body && body.data && body.data.shop && body.data.shop.plan;
  if (!plan || !plan.displayName) {
    Logger.log(`Shopify plan ${storeId}: missing plan in response: ${res.getContentText()}`);
    return null;
  }
  Logger.log(`Shopify plan ${storeId}: ${plan.displayName} (plus=${plan.shopifyPlus}, dev=${plan.partnerDevelopment})`);
  return plan;
}

/**
 * רץ על כל החנויות, שולף את שם התוכנית ב-Shopify של כל אחת, וכותב לטאב
 * store-meta כדי שהדשבורד יוכל לקרוא ולהציע אוטומטית "Basic Shopify ≈ $39/mo".
 *
 * אופציונלי להריץ ידנית או מתוך הטריגר היומי — תוכניות לא משתנות כל יום.
 */
function refreshAllStoreMeta() {
  const ss = ensureSpreadsheet();
  const updatedAt = new Date();
  for (const store of STORES) {
    try {
      const plan = getShopifyPlan(store.id);
      writeStoreMetaRow_(ss, store.id, store.name, plan, updatedAt);
    } catch (e) {
      Logger.log(`store-meta ${store.id} failed: ${e && e.message ? e.message : e}`);
    }
  }
}

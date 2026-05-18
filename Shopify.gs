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

/**
 * Auto-bootstrap helpers. When a Shopify call returns 401 (expired or
 * revoked token), we try to refresh the token via Client Credentials Grant
 * and retry the call once. The user only sees a real failure if EITHER:
 *   - the store has no clientId/clientSecret configured (can't bootstrap), OR
 *   - the bootstrap itself fails (e.g. clientSecret was rotated too).
 *
 * Otherwise the daily run "self-heals" silently and writes a log line so
 * ops can see what happened.
 */
function shopifyCanAutoBootstrap_(storeId) {
  return !!(getProp(`${storeId}.shopify.clientId`) &&
            getProp(`${storeId}.shopify.clientSecret`));
}

function tryAutoBootstrapShopify_(storeId) {
  if (!shopifyCanAutoBootstrap_(storeId)) {
    Logger.log(
      `Shopify ${storeId}: got 401 but no clientId/clientSecret configured ` +
      `— cannot auto-refresh. Run bootstrapAllShopifyTokens manually, or ` +
      `regenerate the token in Shopify Admin → Apps → your custom app → ` +
      `API credentials and put it in Script Properties under ` +
      `'${storeId}.shopify.token'.`
    );
    return null;
  }
  try {
    const newToken = bootstrapShopifyToken(storeId);
    Logger.log(`Shopify ${storeId}: auto-bootstrapped after 401, retrying with fresh token.`);
    return newToken;
  } catch (e) {
    Logger.log(`Shopify ${storeId}: auto-bootstrap failed: ${e && e.message ? e.message : e}`);
    return null;
  }
}

function getShopifyRevenue(storeId, dateStr) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  let token   = requireProp(`${storeId}.shopify.token`);
  let bootstrapTried = false;

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
    // 401 → try refreshing the token once and retry the same URL. Guarded by
    // bootstrapTried so a permanently bad credential doesn't loop.
    if (code === 401 && !bootstrapTried) {
      bootstrapTried = true;
      const fresh = tryAutoBootstrapShopify_(storeId);
      if (fresh) {
        token = fresh;
        continue; // same `url`, fresh token
      }
      // No bootstrap path → fall through to throw with the original 401.
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
  if (safety >= 50) {
    Logger.log(
      `WARNING: hit pagination safety cap of 50 pages for Shopify orders ` +
      `${storeId} ${dateStr} (${count} orders collected, total=${total.toFixed(2)}); ` +
      `data beyond may be missing.`
    );
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
  let token = requireProp(`${storeId}.shopify.token`);
  let bootstrapTried = false;

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
    if (code === 401 && !bootstrapTried) {
      bootstrapTried = true;
      const fresh = tryAutoBootstrapShopify_(storeId);
      if (fresh) { token = fresh; continue; }
    }
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
  if (safety >= 50) {
    Logger.log(
      `WARNING: hit pagination safety cap of 50 pages for Shopify product ` +
      `sales ${storeId} ${dateStr} (${Object.keys(byProduct).length} products ` +
      `collected so far); data beyond may be missing.`
    );
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
 * החזרה: { plan, error }.
 *   plan  = { displayName, partnerDevelopment, shopifyPlus } אם נמצא, אחרת null
 *   error = מחרוזת תיאור הכשל (HTTP error / GraphQL error / missing plan) אם
 *           לא הצלחנו להחזיר plan, אחרת null. הקורא חושף את ה-error בטאב
 *           store-meta כדי שהדשבורד יוכל להציג סיבת כשל אמיתית במקום
 *           לתת אוטומציה שותקת לכשל.
 */
function getShopifyPlan(storeId) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  let token = requireProp(`${storeId}.shopify.token`);

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

  function doFetch() {
    return fetchWithRetry_(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Shopify-Access-Token': token,
        // Explicit Accept defends against rare cases (documented during
        // Shopify status-page incidents) where the endpoint returns HTML or
        // XML instead of JSON. With Accept set, JSON.parse failures fall into
        // the non-JSON branch below rather than throwing past refreshAllStoreMeta
        // and being silently logged as a generic exception.
        'Accept': 'application/json',
      },
      payload: JSON.stringify({ query: query }),
      muteHttpExceptions: true,
    });
  }

  let res = doFetch();
  // 401 → auto-bootstrap and try once more.
  if (res.getResponseCode() === 401) {
    const fresh = tryAutoBootstrapShopify_(storeId);
    if (fresh) { token = fresh; res = doFetch(); }
  }
  const code = res.getResponseCode();
  const responseText = res.getContentText();
  if (code !== 200) {
    const errMsg = `HTTP ${code}: ${responseText.slice(0, 300)}`;
    Logger.log(`Shopify plan ${storeId} failed (${code}): ${responseText}`);
    return { plan: null, error: errMsg };
  }
  let body;
  try {
    body = JSON.parse(responseText);
  } catch (e) {
    const errMsg = `non-JSON response: ${responseText.slice(0, 200)}`;
    Logger.log(`Shopify plan ${storeId}: ${errMsg}`);
    return { plan: null, error: errMsg };
  }
  // GraphQL returns HTTP 200 even on permission/auth errors — surface them.
  if (body && body.errors && body.errors.length) {
    const errMsg = `GraphQL errors: ${JSON.stringify(body.errors).slice(0, 400)}`;
    Logger.log(`Shopify plan ${storeId} ${errMsg}`);
    return { plan: null, error: errMsg };
  }
  const plan = body && body.data && body.data.shop && body.data.shop.plan;
  if (!plan || !plan.displayName) {
    const errMsg = `missing plan in response: ${responseText.slice(0, 300)}`;
    Logger.log(`Shopify plan ${storeId}: ${errMsg}`);
    return { plan: null, error: errMsg };
  }
  Logger.log(`Shopify plan ${storeId}: ${plan.displayName} (plus=${plan.shopifyPlus}, dev=${plan.partnerDevelopment})`);
  return { plan: plan, error: null };
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
      const result = getShopifyPlan(store.id);
      writeStoreMetaRow_(ss, store.id, store.name, result.plan, updatedAt, result.error);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      Logger.log(`store-meta ${store.id} failed: ${msg}`);
      // Bubble exception text into the sheet so the dashboard can show it.
      writeStoreMetaRow_(ss, store.id, store.name, null, updatedAt, `exception: ${msg}`);
    }
  }
}

/**
 * שואב את כל המוצרים הפעילים בחנות (קטלוג מלא, לא רק כאלה שנמכרו).
 *
 * נדרש כדי שה-product picker בדשבורד יוכל להציג גם מוצרים חדשים שעוד לא
 * עשו אפילו הזמנה אחת — בלעדיו אי אפשר לשייך קמפיין חדש למוצר חדש.
 *
 * מסנן רק מוצרים סטטוס=active (לא draft/archived). מחזיר רק את מה שהדשבורד
 * צריך כדי להציג בסלקטור: id, title, status, image url ראשי, ומחיר variant
 * ראשון (לסקירה מהירה).
 */
function getShopifyProductsCatalog(storeId) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  let token = requireProp(`${storeId}.shopify.token`);
  let bootstrapTried = false;

  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json` +
            `?status=active&limit=250&fields=id,title,status,handle,image,variants,product_type,vendor`;

  const out = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) { Utilities.sleep(2000); safety++; continue; }
    if (code === 401 && !bootstrapTried) {
      bootstrapTried = true;
      const fresh = tryAutoBootstrapShopify_(storeId);
      if (fresh) { token = fresh; continue; }
    }
    if (code !== 200) {
      throw new Error(`Shopify catalog ${storeId} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const products = (body && body.products) || [];
    for (const p of products) {
      // Use the first variant's price as a representative — most stores have
      // a single variant or all variants priced similarly. The dashboard
      // shows this as context, not as gospel.
      const firstVariant = (p.variants || [])[0];
      const price = firstVariant ? parseFloat(firstVariant.price || 0) : 0;
      const imageUrl = (p.image && p.image.src) || '';
      out.push({
        productId: String(p.id || ''),
        title: p.title || '(ללא שם)',
        handle: p.handle || '',
        status: p.status || '',
        priceCad: price, // Shopify returns prices in the shop's currency (CAD here)
        imageUrl: imageUrl,
        productType: p.product_type || '',
        vendor: p.vendor || '',
      });
    }
    const link = res.getHeaders()['Link'] || res.getHeaders()['link'] || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    safety++;
  }
  if (safety >= 50) {
    Logger.log(
      `WARNING: hit pagination safety cap of 50 pages for Shopify catalog ` +
      `${storeId} (${out.length} products collected); data beyond may be missing.`
    );
  }
  Logger.log(`Shopify catalog ${storeId}: ${out.length} active products`);
  return out;
}

/**
 * שואב את ההזמנות של היום עם **שדות attribution** (landing_site,
 * referring_site, note_attributes), מסווג כל הזמנה לערוץ המקור שלה
 * ('meta-paid' / 'google-paid' / 'meta-organic' / etc.), ומחזיר מערך
 * שמוכן לכתיבה לטאב `{storeId}-orders-attribution`.
 *
 * הלוגיקה (לפי סדר עדיפות):
 *   1. fbclid נוכח ב-landing_site OR ב-note_attributes → 'meta-paid'
 *      (fbclid נוצר *רק* בקליק על מודעת Meta — proof דטרמיניסטי)
 *   2. gclid נוכח → 'google-paid' (אותו עיקרון, רק ל-Google)
 *   3. utm_medium = 'cpc'/'paid'/'paidsocial' + utm_source מזוהה:
 *      - 'facebook'/'fb'/'instagram'/'ig'/'meta' → 'meta-paid'
 *      - 'google'/'youtube' → 'google-paid'
 *   4. utm_source = 'email'/'newsletter'/'klaviyo' → 'email'
 *   5. referring_site = facebook.com / instagram.com + ללא UTM → 'meta-organic'
 *   6. referring_site = google.com + ללא UTM → 'google-organic'
 *   7. utm_source קיים אבל לא מזוהה (TikTok וכו') → 'other-paid'
 *   8. כלום → 'direct'
 *
 * החזרה: שורות עם order_id, total, source, utm fields, fbclid/gclid flags,
 *         referring_site, ו-utm_campaign (לקישור 1:1 לקמפיין Meta אם
 *         המפרסם מגדיר את שם הקמפיין כ-utm_campaign).
 */
function getShopifyOrdersAttribution(storeId, dateStr) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  let token = requireProp(`${storeId}.shopify.token`);
  let bootstrapTried = false;

  const dayStart = `${dateStr}T00:00:00+03:00`;
  const dayEnd = `${nextDayStr_(dateStr)}T00:00:00+03:00`;

  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
            `?status=any&financial_status=any&limit=250` +
            `&created_at_min=${encodeURIComponent(dayStart)}` +
            `&created_at_max=${encodeURIComponent(dayEnd)}` +
            // Phase 1: `line_items` added so each order arrives with per-line
            // product_id / quantity / price. The dashboard's analyzer needs
            // this to compute "what fraction of orders containing mapped
            // products came from Facebook?" — see SheetBuilder.gs col N.
            `&fields=id,current_total_price,financial_status,test,landing_site,referring_site,note_attributes,source_name,line_items`;

  const out = [];
  let safety = 0;
  while (url && safety < 50) {
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 429) { Utilities.sleep(2000); safety++; continue; }
    if (code === 401 && !bootstrapTried) {
      bootstrapTried = true;
      const fresh = tryAutoBootstrapShopify_(storeId);
      if (fresh) { token = fresh; continue; }
    }
    if (code !== 200) {
      throw new Error(`Shopify orders-attribution ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const orders = (body && body.orders) || [];
    for (const o of orders) {
      if (o.test) continue;
      if (o.financial_status === 'voided') continue;
      const classified = classifyOrderAttribution_(o);
      const totalCad = parseFloat(o.current_total_price || 0);
      out.push({
        orderId: String(o.id || ''),
        totalCad: totalCad,
        source: classified.source,
        utmSource: classified.utmSource,
        utmMedium: classified.utmMedium,
        utmCampaign: classified.utmCampaign,
        utmContent: classified.utmContent,
        // utm_id / utm_term: when Meta's URL Parameters use {{campaign.id}}
        // / {{adset.id}}, these carry the platform's primary keys — strictly
        // more reliable for matching than utm_campaign (names can change,
        // IDs cannot).
        utmId: classified.utmId,
        utmTerm: classified.utmTerm,
        fbclidPresent: classified.fbclidPresent,
        gclidPresent: classified.gclidPresent,
        referringSite: classified.referringSite,
        // Phase 1: per-line-item proportional CAD breakdown. The dashboard
        // serializes this as JSON into col N. Items with null product_id
        // (custom items, deleted products) are filtered out inside the
        // helper — they can never match a campaign's mapped products.
        lineItems: computeLineItemsCad_(o, totalCad),
      });
    }
    const link = res.getHeaders()['Link'] || res.getHeaders()['link'] || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    safety++;
  }
  if (safety >= 50) {
    Logger.log(`WARNING: hit pagination safety cap for Shopify orders-attribution ${storeId} ${dateStr} (${out.length} orders)`);
  }
  Logger.log(`Shopify orders-attribution ${storeId} ${dateStr}: ${out.length} orders classified`);
  return out;
}

/**
 * Phase 1: compute the per-line-item CAD breakdown for a single order.
 *
 * Returns an array of `{p, u, r}` objects — compact key names keep the
 * downstream JSON cell within Sheets' 50K char limit even for big orders.
 *
 * All 3 stores are CAD-native (Shopify.gs:472 — Shopify returns prices in
 * the shop's currency, which is CAD here), so `li.price` is already in
 * CAD. The proportional split is purely to allocate order-level
 * adjustments (tax, shipping, discounts) back to line items so the
 * lineItems[].r sums to totalCad.
 *
 * Three defensive guards (RESEARCH.md Pitfalls 1, 2, A4):
 *   1. Skip items where `product_id` is null/empty (custom items, deleted
 *      products) — they can never match a campaign's mapped products
 *      anyway, so storing them just wastes Sheets cell space.
 *   2. If `sum(price × qty) === 0` (rare: a free-gift / 100%-discount
 *      order), spread totalCad equally across items instead of dividing
 *      by zero (which would produce NaN → cell would render as #NUM!).
 *      Log a warning so the operator can see this in Executions.
 *   3. round2_ each lineCad so the JSON stays compact and free of float
 *      noise.
 */
function computeLineItemsCad_(order, totalCad) {
  const items = (order && order.line_items) || [];
  if (items.length === 0) return [];

  const subtotal = items.reduce(function (s, li) {
    return s + (parseFloat(li.price || 0) * parseInt(li.quantity || 0, 10));
  }, 0);

  const useFlatSpread = !(subtotal > 0);
  if (useFlatSpread) {
    // Pitfall 2: guard divide-by-zero, log so operators can see it in
    // Executions if it ever recurs.
    Logger.log('computeLineItemsCad_: subtotal=0 for order ' + (order && order.id) + ', spreading equally');
  }

  const out = [];
  for (var i = 0; i < items.length; i++) {
    const li = items[i];
    const pid = li && li.product_id != null ? String(li.product_id) : '';
    if (!pid) continue; // Pitfall 1: skip custom / deleted-product items.
    const qty = parseInt(li.quantity || 0, 10);
    const lineGross = parseFloat(li.price || 0) * qty;
    var lineCad;
    if (useFlatSpread) {
      lineCad = items.length > 0 ? (totalCad / items.length) : 0;
    } else {
      lineCad = (lineGross / subtotal) * totalCad;
    }
    out.push({ p: pid, u: qty, r: round2_(lineCad) });
  }
  return out;
}

/**
 * decodeURIComponent that never throws. URIError on malformed percent-escapes
 * is silently swallowed and the raw input is returned — for our purposes a
 * raw "%E0" string is strictly better than aborting the day's classification.
 */
function safeDecode_(s) {
  try { return decodeURIComponent(s); }
  catch (_) { return s; }
}

/**
 * Internal: classify a single Shopify order object into its attribution
 * source. Pulls UTM/fbclid/gclid from landing_site, falls back to
 * note_attributes (some apps stash _fbc/_fbp/fbclid there from the Pixel),
 * and finally to referring_site for organic-source detection.
 *
 * Returns an object the caller embeds into the order row.
 */
function classifyOrderAttribution_(order) {
  const landing = String(order.landing_site || '');
  const ref = String(order.referring_site || '').toLowerCase();
  const noteAttrs = order.note_attributes || [];

  // Parse UTM-like params from landing URL (which is the full URL incl. ?...).
  // decodeURIComponent throws URIError on malformed percent-escapes (e.g. %E0,
  // %FF%FE, stray %). Bot traffic, scrapers, and mis-built affiliate links
  // routinely produce these. Without this guard, a single bad order would
  // throw, propagate up through getShopifyOrdersAttribution into the
  // try/catch in runUpdateForDate, and abort the WHOLE day's
  // orders-attribution write for this store. Decode per-pair so one bad
  // value drops only that param, never the whole order.
  // Null-prototype so a note_attribute named "hasOwnProperty" / "toString"
  // / __proto__ doesn't collide with inherited keys (would otherwise
  // make the `!params[name]` check pick up the inherited function and
  // silently drop the attribute). Defensive — no security exposure in
  // V8 since values are coerced to String, but the lookup correctness
  // matters here. (IN5-05)
  const params = Object.create(null);
  const qIdx = landing.indexOf('?');
  if (qIdx >= 0) {
    const qs = landing.slice(qIdx + 1);
    for (const pair of qs.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = safeDecode_(pair.slice(0, eq)).toLowerCase();
      const v = safeDecode_(pair.slice(eq + 1));
      params[k] = v;
    }
  }
  // Some Shopify integrations stash click IDs in note_attributes — check there too.
  for (const na of noteAttrs) {
    const name = String(na.name || '').toLowerCase();
    if (!name) continue;
    if (!params[name]) params[name] = String(na.value || '');
  }

  const utmSource = params['utm_source'] || '';
  const utmMedium = params['utm_medium'] || '';
  const utmCampaign = params['utm_campaign'] || '';
  const utmContent = params['utm_content'] || '';
  // Meta's URL Parameters convention: utm_id = {{campaign.id}}, utm_term =
  // {{adset.id}}. These give us an ID-based deterministic match — strictly
  // better than utm_campaign-by-name because IDs don't change when an
  // operator renames a campaign and don't have URL-encoding edge cases
  // (Hebrew names, special chars).
  const utmId = params['utm_id'] || '';
  const utmTerm = params['utm_term'] || '';
  const fbclid = !!(params['fbclid'] || params['_fbc']);
  const gclid = !!params['gclid'];

  // Strongest signal first: click-IDs.
  let source;
  if (fbclid) {
    source = 'meta-paid';
  } else if (gclid) {
    source = 'google-paid';
  } else if (/cpc|paid|paidsocial|social/i.test(utmMedium)) {
    if (/^(facebook|fb|meta|instagram|ig)$/i.test(utmSource)) source = 'meta-paid';
    else if (/^(google|youtube)$/i.test(utmSource)) source = 'google-paid';
    else source = 'other-paid';
  } else if (/^(email|newsletter|klaviyo|mailchimp)$/i.test(utmSource)) {
    source = 'email';
  } else if (utmSource) {
    source = 'other-paid'; // tagged but unrecognised (TikTok / influencer / etc.)
  } else if (/(facebook|fb|instagram|ig)\.com/.test(ref)) {
    source = 'meta-organic';
  } else if (/(google|youtube)\.com/.test(ref)) {
    source = 'google-organic';
  } else if (ref) {
    source = 'other-referral';
  } else {
    source = 'direct';
  }

  // Keep referring site short for the sheet.
  const refTrimmed = ref.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 120);

  return {
    source,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmId,
    utmTerm,
    fbclidPresent: fbclid,
    gclidPresent: gclid,
    referringSite: refTrimmed,
  };
}

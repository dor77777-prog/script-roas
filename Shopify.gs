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
 * COGS (Cost of Goods Sold) - מסכם את עלות הפריטים שנמכרו ביום נתון.
 * דורש את הסקופים read_orders + read_products + read_inventory באפליקציית Custom.
 * אם חסר scope - מחזיר 0 ומדפיס אזהרה (לא נופל את ההרצה היומית).
 *
 * שיטה: לכל הזמנה ביום, איסוף variant_ids מ-line_items, ואז GET inventory_items בקבוצות
 * של 250 כדי להשיג את שדה ה-cost. סכום = ∑ quantity × cost.
 */
function getShopifyCogs(storeId, dateStr) {
  const domain = requireProp(`${storeId}.shopify.domain`).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = requireProp(`${storeId}.shopify.token`);

  const dayStart = `${dateStr}T00:00:00+03:00`;
  const dayEnd = `${nextDayStr_(dateStr)}T00:00:00+03:00`;

  // שלב 1: שלוף את ההזמנות של היום עם line_items
  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
            `?status=any&financial_status=any&limit=250` +
            `&created_at_min=${encodeURIComponent(dayStart)}` +
            `&created_at_max=${encodeURIComponent(dayEnd)}` +
            `&fields=id,financial_status,test,line_items`;

  const lineItems = []; // {variantId, qty}
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
      throw new Error(`Shopify COGS orders ${storeId} ${dateStr} failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    const orders = (body && body.orders) || [];
    for (const o of orders) {
      if (o.test) continue;
      if (o.financial_status === 'voided') continue;
      const items = o.line_items || [];
      for (const li of items) {
        if (li.variant_id) {
          lineItems.push({ variantId: li.variant_id, qty: parseInt(li.quantity || 0, 10) });
        }
      }
    }
    const link = res.getHeaders()['Link'] || res.getHeaders()['link'] || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    safety++;
  }

  if (lineItems.length === 0) {
    Logger.log(`Shopify COGS ${storeId} ${dateStr}: no line items`);
    return 0;
  }

  // שלב 2: שלוף inventory_item_id לכל variant (כי cost יושב על inventory_item, לא על variant ישירות)
  const variantIds = [...new Set(lineItems.map(x => x.variantId))];
  const variantToInventoryItem = fetchVariantInventoryMap_(domain, token, variantIds);
  if (!variantToInventoryItem) {
    Logger.log(`Shopify COGS ${storeId} ${dateStr}: SKIPPED (missing read_products scope)`);
    return 0;
  }

  // שלב 3: שלוף cost לכל inventory_item בקבוצות
  const inventoryItemIds = [...new Set(Object.values(variantToInventoryItem))].filter(Boolean);
  const itemToCost = fetchInventoryItemCostMap_(domain, token, inventoryItemIds);
  if (!itemToCost) {
    Logger.log(`Shopify COGS ${storeId} ${dateStr}: SKIPPED (missing read_inventory scope)`);
    return 0;
  }

  // שלב 4: סכום הסופי
  let totalCogs = 0;
  for (const { variantId, qty } of lineItems) {
    const inventoryItemId = variantToInventoryItem[variantId];
    const cost = inventoryItemId ? (itemToCost[inventoryItemId] || 0) : 0;
    totalCogs += cost * qty;
  }
  Logger.log(`Shopify COGS ${storeId} ${dateStr}: ${lineItems.length} line items, total cost=${totalCogs.toFixed(2)} CAD`);
  return totalCogs;
}

/** שולף variant_id -> inventory_item_id דרך GET /variants?ids=... (בקבוצות של 250) */
function fetchVariantInventoryMap_(domain, token, variantIds) {
  const map = {};
  const chunkSize = 250;
  for (let i = 0; i < variantIds.length; i += chunkSize) {
    const chunk = variantIds.slice(i, i + chunkSize).join(',');
    const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/variants.json` +
                `?ids=${chunk}&fields=id,inventory_item_id`;
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 403) return null; // scope missing
    if (code !== 200) {
      throw new Error(`Shopify variants lookup failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    for (const v of (body.variants || [])) {
      map[v.id] = v.inventory_item_id;
    }
  }
  return map;
}

/** שולף inventory_item_id -> cost (בקבוצות של 100) */
function fetchInventoryItemCostMap_(domain, token, ids) {
  const map = {};
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize).join(',');
    const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/inventory_items.json?ids=${chunk}`;
    const res = fetchWithRetry_(url, {
      method: 'get',
      headers: { 'X-Shopify-Access-Token': token },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 403) return null; // scope missing
    if (code !== 200) {
      throw new Error(`Shopify inventory_items lookup failed (${code}): ${res.getContentText()}`);
    }
    const body = JSON.parse(res.getContentText());
    for (const item of (body.inventory_items || [])) {
      map[item.id] = parseFloat(item.cost || 0);
    }
  }
  return map;
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

/**
 * Config.gs
 * הגדרות מערכת + עזרי גישה ל-Script Properties.
 */

const TZ = 'Asia/Jerusalem';
const SUMMARY_TAB = 'סיכום';
const DAILY_FLAT_TAB = 'data-daily';
const PRODUCTS_DAILY_TAB = 'products-daily';
const STORE_META_TAB = 'store-meta';

const SHOPIFY_API_VERSION = '2024-10';
const META_API_VERSION = 'v20.0';
const GOOGLE_ADS_API_VERSION = 'v20';

// הערכת COGS (עלות סחורה) כאחוז מההכנסה היומית.
// נבחר 25% — שינוי עתידי כאן יחול אוטומטית בכל הריצות הבאות.
// **שים לב**: צריך לעדכן גם את COGS_RATE_OF_REVENUE ב-dashboard-web/src/lib/analytics.ts
// כדי שהדשבורד יציג את אותו ערך לתאריכים שעוד לא נכתבו ל-data-daily.
const COGS_RATE_OF_REVENUE = 0.25;

const STORES = [
  { id: 'uzoshop',   name: 'uzoshop',   hasGoogleAds: true  },
  { id: 'zolplus',   name: 'Zol Plus',  hasGoogleAds: false },
  { id: 'usmile360', name: '360usmile', hasGoogleAds: false },
];

const ROAS_COLORS = {
  red:    '#f4cccc',
  orange: '#fce5cd',
  green:  '#d9ead3',
  blue:   '#cfe2f3',
};

const COL = { DATE: 1, SPENT: 2, REVENUE: 3, ROAS: 4 };

function getStoreById(id) {
  return STORES.find(s => s.id === id);
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function getProp(key, defaultValue) {
  const v = props_().getProperty(key);
  return v === null ? (defaultValue === undefined ? '' : defaultValue) : v;
}

function setProp(key, value) {
  props_().setProperty(key, String(value));
}

function requireProp(key) {
  const v = props_().getProperty(key);
  if (!v) throw new Error(`חסר ערך ב-Script Properties: ${key}`);
  return v;
}

function campaignTabName_(storeId) {
  return `${storeId}-campaigns`;
}

function adsTabName_(storeId) {
  return `${storeId}-ads`;
}

function pad2_(n) { return n < 10 ? '0' + n : '' + n; }

function monthNameHe_(month) {
  return ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][month - 1];
}

function nextDayStr_(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

/**
 * ממיר מחרוזת YYYY-MM-DD לאובייקט Date (בלי שעה).
 * אם הקלט כבר Date, מחזיר אותו כמו שהוא. אחרת מחזיר Date שגוי.
 */
function parseYMD_(ymd) {
  if (ymd instanceof Date && !isNaN(ymd.getTime())) return ymd;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function yesterdayStr_() {
  const now = new Date();
  const tzStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const [y, m, d] = tzStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/**
 * UrlFetchApp.fetch עם retry חכם. מטפל ב:
 *   - שגיאות רשת חולפות (Address unavailable / DNS resolution failed / connection reset)
 *   - 5xx server errors (תקלות זמניות מצד השרת)
 *   - 429 rate limit (עם backoff ארוך יותר)
 *
 * נסיונות: עד 4 (כולל הראשון). השהיה: 2s, 5s, 10s (15s ל-429).
 */
function fetchWithRetry_(url, options) {
  const maxAttempts = 4;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      if ((code >= 500 && code < 600) || code === 429) {
        if (attempt < maxAttempts) {
          const wait = code === 429 ? attempt * 5000 : attempt * 2500;
          Logger.log(`fetch attempt ${attempt}/${maxAttempts} got HTTP ${code}, retrying in ${wait/1000}s...`);
          Utilities.sleep(wait);
          continue;
        }
      }
      return res;
    } catch (e) {
      lastError = e;
      const msg = e && e.message ? e.message : String(e);
      if (attempt < maxAttempts) {
        const wait = attempt * 2500;
        Logger.log(`fetch attempt ${attempt}/${maxAttempts} threw: ${msg}. Retrying in ${wait/1000}s...`);
        Utilities.sleep(wait);
      }
    }
  }
  throw lastError || new Error(`fetch failed after ${maxAttempts} attempts`);
}

/**
 * מדפיס ללוג מה הוגדר ב-Script Properties ומה חסר, כדי לעזור באבחון.
 * הרץ לפני setupAll כדי לוודא שהכל במקום.
 */
function verifyConfig() {
  const lines = [];
  const globalMeta = !!getProp('meta.accessToken');
  const issues = [];

  lines.push('=== Global ===');
  lines.push(`meta.accessToken                (גלובלי): ${globalMeta ? '✓' : '— (אפשר להגדיר לפי חנות במקום)'}`);
  for (const k of ['googleads.developerToken','googleads.clientId','googleads.clientSecret','googleads.refreshToken']) {
    const set = !!getProp(k);
    lines.push(`${k.padEnd(40)}: ${set ? '✓' : '✗ חסר'}`);
    if (!set) issues.push(k);
  }
  const mcc = getProp('googleads.loginCustomerId');
  lines.push(`googleads.loginCustomerId       (אופציונלי): ${mcc ? '✓ ' + mcc : '— (לא ב-MCC)'}`);
  // Error-notification recipient. Without it, time-based triggers send
  // alerts to the script owner (or nowhere if Session is unavailable).
  const notifyEmail = getProp('notification.email');
  lines.push(`notification.email              (התראות שגיאה): ${notifyEmail ? '✓ ' + notifyEmail : '— (יפול ל-Session owner; מומלץ להגדיר)'}`);

  for (const store of STORES) {
    lines.push('');
    lines.push(`=== ${store.name} (${store.id}) ===`);

    const sDomain = getProp(`${store.id}.shopify.domain`);
    lines.push(`  shopify.domain        : ${sDomain ? '✓ ' + sDomain : '✗ חסר'}`);
    if (!sDomain) issues.push(`${store.id}.shopify.domain`);

    const sToken = getProp(`${store.id}.shopify.token`);
    const sClientId = getProp(`${store.id}.shopify.clientId`);
    const sClientSecret = getProp(`${store.id}.shopify.clientSecret`);
    if (sToken) {
      lines.push(`  shopify.token         : ✓ (token קיים - מוכן לקריאה)`);
    } else if (sClientId && sClientSecret) {
      lines.push(`  shopify.token         : — (חסר; יש Client ID+Secret → הרץ bootstrapAllShopifyTokens)`);
      issues.push(`${store.id}: צריך bootstrapAllShopifyTokens`);
    } else {
      lines.push(`  shopify.token         : ✗ חסר (וגם clientId/clientSecret חסרים)`);
      issues.push(`${store.id}.shopify.token (או clientId+clientSecret למצב B)`);
    }
    // Auto-bootstrap readiness — clientId/secret together mean the daily run
    // can self-heal on 401 without manual intervention.
    if (sClientId && sClientSecret) {
      lines.push(`  shopify auto-refresh  : ✓ (clientId+clientSecret מוגדרים — 401 יחודש אוטומטית)`);
    } else {
      lines.push(`  shopify auto-refresh  : ✗ (חסר clientId/clientSecret → 401 יחייב הרצה ידנית של bootstrapAllShopifyTokens)`);
    }

    const mToken = getProp(`${store.id}.meta.accessToken`);
    if (mToken) {
      lines.push(`  meta.accessToken      : ✓ (לפי חנות)`);
    } else if (globalMeta) {
      lines.push(`  meta.accessToken      : ✓ (יורש מהגלובלי)`);
    } else {
      lines.push(`  meta.accessToken      : ✗ חסר (לא לפי חנות וגם לא גלובלי)`);
      issues.push(`${store.id}.meta.accessToken או meta.accessToken`);
    }

    const mAcct = getProp(`${store.id}.meta.adAccountId`);
    lines.push(`  meta.adAccountId      : ${mAcct ? '✓ ' + mAcct : '✗ חסר'}`);
    if (!mAcct) issues.push(`${store.id}.meta.adAccountId`);

    if (store.hasGoogleAds) {
      const gCust = getProp(`${store.id}.googleads.customerId`);
      lines.push(`  googleads.customerId  : ${gCust ? '✓ ' + gCust : '✗ חסר'}`);
      if (!gCust) issues.push(`${store.id}.googleads.customerId`);
    }
  }

  lines.push('');
  if (issues.length === 0) {
    lines.push('✓ כל ההגדרות תקינות. ניתן להריץ setupAll.');
  } else {
    lines.push(`✗ חסרים ${issues.length} ערכים:`);
    for (const i of issues) lines.push(`  - ${i}`);
  }

  const msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * Emergency: reset the spreadsheet.id Script Property back to a known-good
 * value. Use this when ensureSpreadsheet created a "phantom" spreadsheet
 * (e.g. after a Sheets API timeout was misinterpreted as 'not found') and
 * subsequent runs need to be pointed back to the original sheet that the
 * dashboard reads from.
 *
 * Usage: edit the constant below to your real sheet ID, then run this
 * function once from the Apps Script editor.
 *
 * To find the real ID: open the dashboard's Vercel project → Settings →
 * Environment Variables → SPREADSHEET_ID. That's the truth — Vercel never
 * had the phantom ID.
 */
function resetSpreadsheetIdToKnownGood() {
  // ⚠️ Edit this to your real spreadsheet ID before running.
  const REAL_ID = '1f5tbc-8eMG60Go1ubTldWALc_kwnpaXD_33IsPDWrAk';

  const previous = getProp('spreadsheet.id');
  Logger.log(`Current spreadsheet.id: ${previous}`);
  Logger.log(`Setting spreadsheet.id to: ${REAL_ID}`);
  setProp('spreadsheet.id', REAL_ID);
  // Verify by trying to open it. If this throws, you have the wrong ID.
  try {
    const ss = SpreadsheetApp.openById(REAL_ID);
    Logger.log(`✓ Opened successfully: ${ss.getName()} (${ss.getUrl()})`);
  } catch (e) {
    Logger.log(`✗ Failed to open ${REAL_ID}: ${e && e.message ? e.message : e}`);
    // Restore the previous ID so we don't leave the script in a broken state.
    if (previous) {
      setProp('spreadsheet.id', previous);
      Logger.log(`Restored previous spreadsheet.id: ${previous}`);
    }
    throw new Error(`Reset failed — REAL_ID ${REAL_ID} is not openable. Check the constant and try again.`);
  }
}

/**
 * Read-only diagnostic — prints which spreadsheet the Apps Script side
 * thinks it's using. Useful for confirming the reset worked OR for
 * detecting drift in the future.
 */
function printCurrentSpreadsheetId() {
  const id = getProp('spreadsheet.id');
  Logger.log(`spreadsheet.id Script Property: ${id || '(not set)'}`);
  if (!id) return;
  try {
    const ss = SpreadsheetApp.openById(id);
    Logger.log(`Resolves to: ${ss.getName()} — ${ss.getUrl()}`);
  } catch (e) {
    Logger.log(`Cannot open: ${e && e.message ? e.message : e}`);
  }
}

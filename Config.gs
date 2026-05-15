/**
 * Config.gs
 * הגדרות מערכת + עזרי גישה ל-Script Properties.
 */

const TZ = 'Asia/Jerusalem';
const SUMMARY_TAB = 'סיכום';

const SHOPIFY_API_VERSION = '2024-10';
const META_API_VERSION = 'v20.0';
const GOOGLE_ADS_API_VERSION = 'v17';

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

function pad2_(n) { return n < 10 ? '0' + n : '' + n; }

function monthNameHe_(month) {
  return ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][month - 1];
}

function nextDayStr_(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

function yesterdayStr_() {
  const now = new Date();
  const tzStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const [y, m, d] = tzStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
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

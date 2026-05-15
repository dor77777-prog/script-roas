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

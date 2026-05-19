/**
 * WhatsApp daily summary notifications via Twilio.
 *
 * Three triggers per day:
 *   - 12:00 (noon)         -> today so far
 *   - 18:00 (evening)      -> today so far
 *   - 00:05 (next morning) -> yesterday full day
 *
 * Each notification sends to 2 phone numbers configured in Script Properties.
 *
 * Required Script Properties (set via Project Settings -> Script Properties):
 *   - twilio.accountSid       e.g. "ACxxxxxxxxxxxxxxxx"
 *   - twilio.authToken        Twilio auth token
 *   - twilio.whatsappFrom     e.g. "whatsapp:+14155238886" (sandbox) or paid number
 *   - notify.phone1           e.g. "whatsapp:+972501234567"
 *   - notify.phone2           e.g. "whatsapp:+972507654321"
 *   - notify.dashboardUrl     (optional, defaults to production URL)
 *
 * Setup (one-time, from Apps Script editor):
 *   1. Set the 5-6 Script Properties above
 *   2. Run setupNotificationTriggers() once
 *   3. (optional) Run testNoonNotification() to verify before triggers fire
 */

const NOTIFY_DASHBOARD_URL_DEFAULT = 'https://roas-dashboard-smoky.vercel.app';

/**
 * Reads Twilio + phone-number config from Script Properties.
 *
 * Required: twilio.accountSid, twilio.authToken, twilio.whatsappFrom,
 *           notify.phone1
 * Optional: notify.phone2 (if set, also sends to this number),
 *           notify.dashboardUrl (default points to production URL)
 *
 * Throws if any REQUIRED key is missing so failures are loud during setup.
 */
function getNotifyConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    accountSid:   props.getProperty('twilio.accountSid')   || '',
    authToken:    props.getProperty('twilio.authToken')    || '',
    whatsappFrom: props.getProperty('twilio.whatsappFrom') || '',
    phone1:       props.getProperty('notify.phone1')       || '',
    phone2:       props.getProperty('notify.phone2')       || '',
    dashboardUrl: props.getProperty('notify.dashboardUrl') || NOTIFY_DASHBOARD_URL_DEFAULT,
  };
  const missing = [];
  if (!cfg.accountSid)   missing.push('twilio.accountSid');
  if (!cfg.authToken)    missing.push('twilio.authToken');
  if (!cfg.whatsappFrom) missing.push('twilio.whatsappFrom');
  if (!cfg.phone1)       missing.push('notify.phone1');
  // phone2 is OPTIONAL — if blank, only phone1 receives the notification.
  if (missing.length) {
    throw new Error('Missing Script Properties for WhatsApp notifications: ' + missing.join(', '));
  }
  return cfg;
}

/**
 * Sends one WhatsApp message via Twilio. Throws on non-2xx status.
 * Twilio Sandbox numbers REQUIRE the recipient to have joined the sandbox
 * first by texting "join <keyword>" to the sandbox number from WhatsApp.
 */
function sendWhatsAppViaTwilio_(cfg, toNumber, body) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + cfg.accountSid + '/Messages.json';
  const options = {
    method: 'post',
    payload: { From: cfg.whatsappFrom, To: toNumber, Body: body },
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(cfg.accountSid + ':' + cfg.authToken),
    },
    muteHttpExceptions: true,
  };
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('Twilio HTTP ' + code + ': ' + res.getContentText().slice(0, 500));
  }
  return JSON.parse(res.getContentText());
}

/**
 * Reads a per-store orders-attribution tab and counts orders for a single
 * date, broken down by source bucket.
 *
 * orders-attribution columns: A=date, B=orderId, C=totalCad, D=source, ...
 *
 * Buckets (per Shopify.gs source classification):
 *   - facebook: orders with source === 'meta-paid'
 *   - google:   orders with source === 'google-paid'
 *   - other:    everything else (direct, meta-organic, google-organic, '', etc.)
 */
function countOrdersForDate_(ss, storeId, dateStr) {
  const tabName = ordersAttributionTabName_(storeId);
  const sh = ss.getSheetByName(tabName);
  if (!sh) return { total: 0, facebook: 0, google: 0, other: 0 };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { total: 0, facebook: 0, google: 0, other: 0 };
  // Only need cols A (date) and D (source) — read 4 cols to keep range simple
  const data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
  let total = 0, facebook = 0, google = 0, other = 0;
  for (const row of data) {
    const raw = row[0];
    if (!raw) continue;
    var rowDate;
    if (raw instanceof Date) {
      rowDate = Utilities.formatDate(raw, TZ, 'yyyy-MM-dd');
    } else {
      rowDate = String(raw).slice(0, 10);
    }
    if (rowDate !== dateStr) continue;
    total++;
    const source = String(row[3] || '').trim();
    if (source === 'meta-paid') facebook++;
    else if (source === 'google-paid') google++;
    else other++;
  }
  return { total: total, facebook: facebook, google: google, other: other };
}

/**
 * Builds a per-store + total summary for a single date by reading
 * data-daily tab + per-store orders-attribution tabs. Returns null if
 * no rows match the requested date.
 *
 * data-daily columns (A..K): date, storeId, storeName, fbSpend, gaSpend,
 * totalSpend, revenue, roas, grossProfit, cogs, netProfit. Spend + revenue
 * are already in CAD (converted via ilsToCad in updateStoreForDate_).
 *
 * Order counts come from {storeId}-orders-attribution tabs.
 */
function buildStoreSummary_(dateStr) {
  const ss = ensureSpreadsheet();
  const sh = ss.getSheetByName('data-daily');
  if (!sh) throw new Error('data-daily tab not found in spreadsheet');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const data = sh.getRange(2, 1, lastRow - 1, 11).getValues();

  const stores = {};
  const totals = {
    spend: 0, fbSpend: 0, gaSpend: 0, revenue: 0,
    orders: 0, facebook: 0, google: 0, other: 0,
  };
  for (const row of data) {
    const raw = row[0];
    if (!raw) continue;
    var rowDate;
    if (raw instanceof Date) {
      rowDate = Utilities.formatDate(raw, TZ, 'yyyy-MM-dd');
    } else {
      rowDate = String(raw).slice(0, 10);
    }
    if (rowDate !== dateStr) continue;
    const storeId   = String(row[1] || '').trim();
    const storeName = String(row[2] || '').trim();
    if (!storeId) continue;
    const fbSpend = Number(row[3]) || 0;
    const gaSpend = Number(row[4]) || 0;
    const total   = Number(row[5]) || (fbSpend + gaSpend);
    const revenue = Number(row[6]) || 0;
    const counts  = countOrdersForDate_(ss, storeId, dateStr);
    stores[storeId] = {
      storeName: storeName,
      fbSpend:   fbSpend,
      gaSpend:   gaSpend,
      totalSpend: total,
      revenue:   revenue,
      roas: total > 0 ? revenue / total : 0,
      orders:   counts.total,
      facebook: counts.facebook,
      google:   counts.google,
      other:    counts.other,
    };
    totals.fbSpend  += fbSpend;
    totals.gaSpend  += gaSpend;
    totals.spend    += total;
    totals.revenue  += revenue;
    totals.orders   += counts.total;
    totals.facebook += counts.facebook;
    totals.google   += counts.google;
    totals.other    += counts.other;
  }
  totals.roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  return { dateStr: dateStr, stores: stores, totals: totals };
}

function formatRoas_(roas) {
  if (!isFinite(roas) || roas === 0) return '—';
  return roas.toFixed(2);
}

function formatCad_(amount) {
  if (!isFinite(amount)) return 'C$0';
  return 'C$' + Math.round(amount).toLocaleString('en-CA');
}

/**
 * Composes the WhatsApp message body (Hebrew, plain text, no markdown).
 *
 * Per-store breakdown:
 *   - הוצאה (CAD)
 *   - הכנסות (CAD)
 *   - ROAS
 *   - הזמנות total + breakdown by source (Facebook / Google / Other)
 *
 * Then grand total across all stores + dashboard link.
 *
 * Source buckets per Shopify.gs classification:
 *   - "פייסבוק" = meta-paid orders
 *   - "גוגל" = google-paid orders
 *   - "אחרים" = direct + meta-organic + google-organic + empty + everything else
 */
function buildMessageBody_(summary, title, dashboardUrl) {
  if (!summary || Object.keys(summary.stores).length === 0) {
    return title +
      '\n\nאין נתונים זמינים ל' + (summary && summary.dateStr ? '-' + summary.dateStr : 'תאריך זה') + '.' +
      '\n\n📈 ' + dashboardUrl;
  }
  const lines = [];
  lines.push(title);
  lines.push('');
  for (const sid of Object.keys(summary.stores)) {
    const s = summary.stores[sid];
    lines.push('🏪 ' + s.storeName + ':');
    lines.push('  • הוצאה: ' + formatCad_(s.totalSpend));
    lines.push('  • הכנסות: ' + formatCad_(s.revenue));
    lines.push('  • ROAS: ' + formatRoas_(s.roas));
    lines.push('  • הזמנות: ' + s.orders +
      '  (פייסבוק: ' + s.facebook +
      ', גוגל: ' + s.google +
      ', אחרים: ' + s.other + ')');
    lines.push('');
  }
  lines.push('🎯 סה"כ:');
  lines.push('  • הוצאה: ' + formatCad_(summary.totals.spend));
  lines.push('  • הכנסות: ' + formatCad_(summary.totals.revenue));
  lines.push('  • ROAS: ' + formatRoas_(summary.totals.roas));
  lines.push('  • הזמנות: ' + summary.totals.orders +
    '  (פייסבוק: ' + summary.totals.facebook +
    ', גוגל: ' + summary.totals.google +
    ', אחרים: ' + summary.totals.other + ')');
  lines.push('');
  lines.push('📈 ' + dashboardUrl);
  return lines.join('\n');
}

function todayIlStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function prevDayStr_(dateStr) {
  const parts = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
  return Utilities.formatDate(dt, TZ, 'yyyy-MM-dd');
}

/**
 * Core send pipeline.
 *
 * If we're sending a summary of today and today's row may be stale, refresh
 * the live data first. Calls are best-effort: refresh failures are logged
 * but don't block the send (stale data is better than no message).
 */
function sendNotificationForDate_(dateStr, title) {
  const cfg = getNotifyConfig_();
  if (dateStr === todayIlStr_()) {
    try {
      refreshAllStoresNow();
    } catch (e) {
      Logger.log('refreshAllStoresNow before notification failed (continuing with stale data): ' + e);
    }
  }
  const summary = buildStoreSummary_(dateStr);
  const body = buildMessageBody_(summary, title, cfg.dashboardUrl);
  // phone2 is optional — filter out blanks so a missing notify.phone2 just
  // means "single-recipient mode" instead of an error.
  const recipients = [cfg.phone1, cfg.phone2].filter(function (p) { return !!p; });
  for (const to of recipients) {
    try {
      sendWhatsAppViaTwilio_(cfg, to, body);
      Logger.log('Sent WhatsApp summary for ' + dateStr + ' to ' + to);
    } catch (e) {
      const errMsg = 'WhatsApp send to ' + to + ' for ' + dateStr + ' failed: ' + e;
      Logger.log(errMsg);
      try { notifyError_(dateStr, errMsg); } catch (_) { /* best-effort */ }
    }
  }
}

function sendNoonNotification() {
  const today = todayIlStr_();
  sendNotificationForDate_(today, '📊 ROAS Snapshot — 12:00, ' + today);
}

function sendEveningNotification() {
  const today = todayIlStr_();
  sendNotificationForDate_(today, '📊 ROAS Snapshot — 18:00, ' + today);
}

function sendEodNotification() {
  const yesterday = prevDayStr_(todayIlStr_());
  sendNotificationForDate_(yesterday, '📊 ROAS Summary — סיכום יום מלא ' + yesterday);
}

// ============================================================================
// Manual test functions — run from Apps Script editor without waiting for
// the daily trigger to fire.
// ============================================================================

function testNoonNotification()    { sendNoonNotification();    }
function testEveningNotification() { sendEveningNotification(); }
function testEodNotification()     { sendEodNotification();     }

// ============================================================================
// Trigger management. Run setupNotificationTriggers() ONCE from the editor
// after Script Properties are configured. Subsequent runs replace existing
// triggers so it's safe to re-run if you change the schedule.
// ============================================================================

const NOTIFICATION_HANDLER_NAMES = ['sendNoonNotification', 'sendEveningNotification', 'sendEodNotification'];

function setupNotificationTriggers() {
  // Remove existing notification triggers so we don't accumulate duplicates
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (NOTIFICATION_HANDLER_NAMES.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  }
  // Apps Script time-based triggers run within a 1-hour window of the given
  // hour. For "00:05" we use atHour(0) which fires sometime in [0:00, 1:00).
  ScriptApp.newTrigger('sendNoonNotification')
    .timeBased().atHour(12).everyDays(1).create();
  ScriptApp.newTrigger('sendEveningNotification')
    .timeBased().atHour(18).everyDays(1).create();
  ScriptApp.newTrigger('sendEodNotification')
    .timeBased().atHour(0).everyDays(1).create();
  Logger.log('Created 3 notification triggers: 12:00, 18:00, ~00:00-01:00 daily (script TZ).');
}

function listNotificationTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let found = 0;
  for (const t of triggers) {
    if (NOTIFICATION_HANDLER_NAMES.indexOf(t.getHandlerFunction()) >= 0) {
      Logger.log('Trigger: ' + t.getHandlerFunction() + ' (ID: ' + t.getUniqueId() + ')');
      found++;
    }
  }
  if (!found) Logger.log('No notification triggers found.');
}

function removeAllNotificationTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const t of triggers) {
    if (NOTIFICATION_HANDLER_NAMES.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' notification triggers.');
}

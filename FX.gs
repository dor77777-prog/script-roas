/**
 * FX.gs - שערי חליפין דרך Frankfurter (חינמי, ללא מפתח, מבוסס ECB).
 * אם נשאל על תאריך סוף שבוע/חג, ה-API מחזיר אוטומטית את שער יום העסקים הקודם.
 */

function getFxRate(from, to, dateStr) {
  if (from === to) return 1;

  const cacheKey = `fx.${from}.${to}.${dateStr}`;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached !== null) return parseFloat(cached);

  const url = `https://api.frankfurter.dev/v1/${dateStr}?base=${from}&symbols=${to}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error(`FX fetch failed (${from}->${to} on ${dateStr}): ${res.getContentText()}`);
  }
  const data = JSON.parse(res.getContentText());
  const rate = data && data.rates ? data.rates[to] : null;
  if (!rate) throw new Error(`לא נמצא שער חליפין ${from}->${to} עבור ${dateStr}`);

  cache.put(cacheKey, String(rate), 21600);
  return rate;
}

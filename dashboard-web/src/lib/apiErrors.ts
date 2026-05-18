/**
 * Translate raw Google API errors into Hebrew messages safe to render in the
 * client UI. Raw messages embed the spreadsheet ID and service account email,
 * neither of which a partner UI user needs to see. The full raw message
 * should still be logged server-side via `console.error` for ops.
 *
 * Single shared helper used by ALL API routes (/api/data, /api/campaigns,
 * /api/products, /api/ads, /api/orders-attribution, /api/store-meta,
 * /api/product-catalog, /api/dashboard-state). Previously /api/store-meta
 * and /api/dashboard-state had inline copies that diverged from each other;
 * this module unifies the contract.
 *
 * @see CR-01 in 02-foundations/02-REVIEW.md — six routes were leaking raw
 *   `err.message` (containing spreadsheet IDs + service-account emails) to
 *   the browser. This helper closes that information-disclosure hole.
 */
export function userFacingError(message: string): string {
  if (/permission|forbidden|403/i.test(message)) {
    return 'הטעינה נכשלה: הרשאות אינן מספיקות.';
  }
  if (/not found|404|Unable to parse range/i.test(message)) {
    return 'הטעינה נכשלה: הגיליון לא נמצא.';
  }
  if (/quota|429|rate ?limit/i.test(message)) {
    return 'הטעינה נכשלה: חרגנו ממכסת Google.';
  }
  if (/Missing GOOGLE_CLIENT_EMAIL|GOOGLE_PRIVATE_KEY|SPREADSHEET_ID|Missing GOOGLE_/i.test(message)) {
    return 'הטעינה נכשלה: משתני סביבה חסרים.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(message)) {
    return 'הטעינה נכשלה: שגיאת רשת.';
  }
  return 'הטעינה נכשלה: שגיאה לא צפויה.';
}

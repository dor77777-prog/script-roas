/**
 * Project-wide constants. The values here are deliberately NOT inferred from
 * live data — they are stable references used in places where a live lookup
 * would be wrong (e.g. Shopify plan-price suggestions, where we want the
 * suggestion to be reproducible across sessions, not jitter with daily FX).
 */

/**
 * Frozen USD→CAD rate used for Shopify-plan suggestion math and CSV import
 * conversion when the CSV is in USD. The dashboard's actual ad-spend
 * conversion uses the live FX rate from Apps Script (`getFxRate`), so the
 * production P&L numbers are NOT pinned to this constant — only the
 * suggestion / preview math.
 *
 * Why we don't use the live rate here:
 *   - Plan suggestions should be deterministic: "Basic Shopify ≈ CAD 53" on
 *     Monday should still read "≈ CAD 53" on Wednesday. Otherwise users see
 *     the number wobble and assume something is broken.
 *   - The CSV preview math should match the value the user will see on the
 *     bill, which is converted once at issue time, not at preview time.
 *
 * Re-check this value quarterly. Last reviewed: 2026-Q2.
 */
export const FROZEN_USD_TO_CAD = 1.36;

/**
 * Task 9 — Gap-fill UTM fields on a ShopifyOrderRow from a
 * CustomerJourneyEntry (Shopify customerJourneySummary GraphQL data).
 *
 * Design invariants:
 *   - ONLY fills EMPTY fields — never overwrites a present (non-null/non-empty) value.
 *   - NEVER changes `source` (deterministic attribution field).
 *   - Returns a NEW row object (no mutation).
 *   - When `entry` is undefined (flag off / reader unavailable / order not in map),
 *     returns the original row UNCHANGED — zero-regression when the feature is off.
 *
 * Last-touch: `utmSource/Medium/Campaign/Content/Id/Term` filled from `entry.last`
 * when the current value is null.
 * First-touch: `firstUtmSource/Medium/Campaign/Content/Id/Term` filled from
 * `entry.first` when the current value is null.
 */

import type { ShopifyOrderRow } from '@/lib/fetchers/shopify';
import type { CustomerJourneyEntry } from '@/lib/fetchers/shopifyCustomerJourney';

/**
 * Gap-fill ONLY: fill an order's empty UTM fields from the Shopify customer
 * journey. NEVER overwrites a present value, NEVER changes `source`. Last-touch
 * (`utm*`, string | null) is filled from `entry.last` only when currently null,
 * first-touch (`firstUtm*`, string | null) from `entry.first` when null.
 * Returns a NEW row (no mutation).
 */
export function mergeCustomerJourney(
  row: ShopifyOrderRow,
  entry: CustomerJourneyEntry | undefined,
): ShopifyOrderRow {
  if (!entry) return row;
  const L = entry.last;
  const F = entry.first;
  return {
    ...row,
    // last-touch gap-fill — only when null
    utmSource:   row.utmSource   == null && L?.utmSource   ? L.utmSource   : row.utmSource,
    utmMedium:   row.utmMedium   == null && L?.utmMedium   ? L.utmMedium   : row.utmMedium,
    utmCampaign: row.utmCampaign == null && L?.utmCampaign ? L.utmCampaign : row.utmCampaign,
    utmContent:  row.utmContent  == null && L?.utmContent  ? L.utmContent  : row.utmContent,
    utmId:       row.utmId       == null && L?.utmId       ? L.utmId       : row.utmId,
    utmTerm:     row.utmTerm     == null && L?.utmTerm     ? L.utmTerm     : row.utmTerm,
    // first-touch gap-fill — only when null
    firstUtmSource:   row.firstUtmSource   == null && F?.utmSource   ? F.utmSource   : row.firstUtmSource,
    firstUtmMedium:   row.firstUtmMedium   == null && F?.utmMedium   ? F.utmMedium   : row.firstUtmMedium,
    firstUtmCampaign: row.firstUtmCampaign == null && F?.utmCampaign ? F.utmCampaign : row.firstUtmCampaign,
    firstUtmContent:  row.firstUtmContent  == null && F?.utmContent  ? F.utmContent  : row.firstUtmContent,
    firstUtmId:       row.firstUtmId       == null && F?.utmId       ? F.utmId       : row.firstUtmId,
    firstUtmTerm:     row.firstUtmTerm     == null && F?.utmTerm     ? F.utmTerm     : row.firstUtmTerm,
    // `source` MUST NOT appear in the overrides above — it is deterministic
    // and set by classifyOrderAttribution; never touched by journey data.
  };
}

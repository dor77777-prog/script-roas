/**
 * Task 8 — Shopify customerJourneySummary GraphQL reader.
 *
 * Reads the FIRST and LAST visit UTM parameters for a batch of orders via
 * Shopify Admin GraphQL `Order.customerJourneySummary`.
 *
 * This field requires **Protected Customer Data** approval which the operator
 * may not have yet, so the reader is CAPABILITY-GATED:
 *
 *   1. Behind the env flag `ENABLE_SHOPIFY_CUSTOMER_JOURNEY='1'` (default off).
 *      When off, returns `{ map: empty, disabled: true }` WITHOUT making a request.
 *
 *   2. Self-detects access-denied → returns `{ map: empty, unavailable: true }`,
 *      never throws, never regresses. Only logs a single console.warn.
 *
 * GraphQL POST pattern reused from shopifyBulkFirstOrder.ts:
 *   POST https://{domain}/admin/api/{SHOPIFY_API_VERSION}/graphql.json
 *   Headers: Content-Type + X-Shopify-Access-Token
 *   Body: { query, variables }
 *
 * API version kept in sync with shopifyBulkFirstOrder.ts (2026-04).
 * If that file starts exporting the constant, import from there instead.
 */

// Keep in sync with shopifyBulkFirstOrder.ts (defines the same constant locally)
const SHOPIFY_API_VERSION = '2026-04';

/** UTM data extracted from one shop visit. */
export interface VisitUtm {
  landingPage: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  /**
   * Parsed from landingPage's query string param `utm_id`.
   * Shopify's UtmParameters type has NO id field — only source/medium/campaign/content/term.
   * So we parse it ourselves from the URL.
   */
  utmId: string | null;
}

/** First + last visit UTM data for one order. */
export interface CustomerJourneyEntry {
  first: VisitUtm | null;
  last: VisitUtm | null;
}

/** Result of a fetchCustomerJourney call. */
export interface CustomerJourneyResult {
  /** Map keyed by numeric order id (last path segment of the GID). */
  map: Map<string, CustomerJourneyEntry>;
  /** True when the env flag is off — no request was made. */
  disabled: boolean;
  /** True when the response indicated Protected Customer Data access is denied. */
  unavailable: boolean;
}

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const CUSTOMER_JOURNEY_QUERY = `
query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      customerJourneySummary {
        firstVisit { landingPage source utmParameters { source medium campaign content term } }
        lastVisit  { landingPage source utmParameters { source medium campaign content term } }
      }
    }
  }
}`.trim();

// ---------------------------------------------------------------------------
// Types for the raw GraphQL response
// ---------------------------------------------------------------------------

interface RawUtmParameters {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

interface RawVisit {
  landingPage?: string | null;
  source?: string | null;
  utmParameters?: RawUtmParameters | null;
}

interface RawCustomerJourneySummary {
  firstVisit?: RawVisit | null;
  lastVisit?: RawVisit | null;
}

interface RawOrderNode {
  id: string;
  customerJourneySummary?: RawCustomerJourneySummary | null;
}

interface RawGraphQLResponse {
  data?: { nodes?: Array<RawOrderNode | null> | null } | null;
  errors?: Array<{ message?: string; extensions?: { code?: string } }> | null;
}

// ---------------------------------------------------------------------------
// Access-denied detection regex
// ---------------------------------------------------------------------------

const ACCESS_DENIED_RE = /ACCESS_DENIED|not approved|protected customer data|requires.*approval/i;

function isAccessDenied(errors: NonNullable<RawGraphQLResponse['errors']>): boolean {
  return ACCESS_DENIED_RE.test(JSON.stringify(errors));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Strip "gid://shopify/Order/123" → "123". */
function gidTail(gid: string): string {
  const i = gid.lastIndexOf('/');
  return i >= 0 ? gid.slice(i + 1) : gid;
}

/**
 * Parse `utm_id` from a landingPage URL.
 * Uses 'https://x' as a base so relative paths are parseable.
 * Returns null on any error or when param is missing.
 */
function parseUtmId(landingPage: string | null | undefined): string | null {
  if (!landingPage) return null;
  try {
    const url = new URL(landingPage, 'https://x');
    return url.searchParams.get('utm_id');
  } catch {
    return null;
  }
}

/** Map a raw visit object to VisitUtm. Returns null if visit is nullish. */
function parseVisit(visit: RawVisit | null | undefined): VisitUtm | null {
  if (!visit) return null;
  const p = visit.utmParameters;
  return {
    landingPage: visit.landingPage ?? null,
    source: visit.source ?? null,
    utmSource: p?.source ?? null,
    utmMedium: p?.medium ?? null,
    utmCampaign: p?.campaign ?? null,
    utmContent: p?.content ?? null,
    utmTerm: p?.term ?? null,
    utmId: parseUtmId(visit.landingPage),
  };
}

/** Parse a raw Order node into a CustomerJourneyEntry. */
function parseOrderNode(node: RawOrderNode): CustomerJourneyEntry {
  const cjs = node.customerJourneySummary;
  return {
    first: parseVisit(cjs?.firstVisit),
    last: parseVisit(cjs?.lastVisit),
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

const BATCH_SIZE = 250;

/**
 * Fetch customerJourneySummary for the given order GIDs.
 *
 * @param domain  Shopify store domain, e.g. "my-store.myshopify.com"
 * @param token   Shopify Admin API access token
 * @param orderGids  Array of order GIDs, e.g. ["gid://shopify/Order/123", ...]
 */
export async function fetchCustomerJourney(
  domain: string,
  token: string,
  orderGids: string[],
): Promise<CustomerJourneyResult> {
  // Gate 1: env flag must be '1' or 'true'
  const flag = process.env.ENABLE_SHOPIFY_CUSTOMER_JOURNEY;
  const enabled = flag === '1' || flag === 'true';
  if (!enabled) {
    return { map: new Map(), disabled: true, unavailable: false };
  }

  // Gate 2: nothing to do
  if (orderGids.length === 0) {
    return { map: new Map(), disabled: false, unavailable: false };
  }

  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };

  const resultMap = new Map<string, CustomerJourneyEntry>();

  // Batch into chunks of ≤250
  for (let offset = 0; offset < orderGids.length; offset += BATCH_SIZE) {
    const batch = orderGids.slice(offset, offset + BATCH_SIZE);

    let body: RawGraphQLResponse;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: CUSTOMER_JOURNEY_QUERY, variables: { ids: batch } }),
      });

      if (!res.ok) {
        console.warn(
          `[shopifyCustomerJourney] HTTP ${res.status} for ${domain} batch ${offset / BATCH_SIZE + 1}`,
        );
        // Degrade: skip this batch, continue
        continue;
      }

      body = (await res.json()) as RawGraphQLResponse;
    } catch (err) {
      console.warn('[shopifyCustomerJourney] fetch error:', err);
      // Degrade: return what we have so far
      return { map: resultMap, disabled: false, unavailable: false };
    }

    // Capability detection: check top-level errors
    if (body.errors && body.errors.length > 0) {
      if (isAccessDenied(body.errors)) {
        console.warn(
          '[shopifyCustomerJourney] Protected Customer Data access denied. ' +
            'Grant the required approval in the Shopify Partner Dashboard, then set ' +
            'ENABLE_SHOPIFY_CUSTOMER_JOURNEY=1.',
        );
        return { map: new Map(), disabled: false, unavailable: true };
      }
      // Other GraphQL errors: log and degrade
      console.warn('[shopifyCustomerJourney] GraphQL errors:', body.errors);
      continue;
    }

    // Parse nodes
    const nodes = body.data?.nodes ?? [];
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string') continue;
      const numericId = gidTail(node.id);
      resultMap.set(numericId, parseOrderNode(node));
    }
  }

  return { map: resultMap, disabled: false, unavailable: false };
}

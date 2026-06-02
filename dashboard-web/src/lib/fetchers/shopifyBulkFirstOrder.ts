/**
 * Phase 3 — one-time Shopify Bulk-Operations backfill for is_first_order.
 *
 * READ-ONLY toward Shopify; ZERO writes to ad platforms. Exports per store:
 *   { order.id, createdAt, customer.id }
 * via bulkOperationRunQuery → poll currentBulkOperation → download NDJSON →
 * resolveFirstOrdersFromBulkLines → caller UPSERTs is_first_order into
 * orders_attribution (keyed by the numeric order id tail).
 *
 * Privacy: only customer.id (opaque) is requested — never name/email/phone.
 *
 * The network functions are thin; the resolver + parser are pure and unit-
 * tested. A throwaway operator script wires `runBulkFirstOrderBackfill` to a
 * Supabase admin client per store (see manual-verification checklist).
 */
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';
import { fetchWithBackoff } from './withBackoff';

const SHOPIFY_API_VERSION = '2026-04';

/** One exported order line from the Bulk NDJSON. */
export type BulkOrderLine = {
  id: string;
  createdAt: string;
  customer: { id?: string | null } | null;
};

/** GraphQL document exporting {id, createdAt, customer{id}} for ALL orders. */
export const BULK_FIRST_ORDER_QUERY = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      orders {
        edges {
          node {
            id
            createdAt
            customer { id }
          }
        }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`.trim();

/** Strip "gid://shopify/Order/123" → "123" (matches REST order_id tails). */
function gidTail(gid: string): string {
  const i = gid.lastIndexOf('/');
  return i >= 0 ? gid.slice(i + 1) : gid;
}

/** Parse Bulk NDJSON text → BulkOrderLine[] (skips blanks + malformed lines). */
export function parseBulkNdjson(ndjson: string): BulkOrderLine[] {
  const out: BulkOrderLine[] = [];
  for (const raw of ndjson.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Partial<BulkOrderLine>;
      if (typeof obj.id !== 'string' || typeof obj.createdAt !== 'string') continue;
      out.push({
        id: obj.id,
        createdAt: obj.createdAt,
        customer:
          obj.customer && typeof obj.customer === 'object'
            ? { id: obj.customer.id ?? null }
            : null,
      });
    } catch {
      // malformed line — skip (one bad row must not abort the batch)
    }
  }
  return out;
}

/**
 * Pure resolver: numeric-order-id → first-order classification.
 *   true  = earliest (MIN createdAt; smallest id tiebreak) order for the customer
 *   false = a later order for the same customer
 *   null  = guest line (no customer id) → unclassifiable
 */
export function resolveFirstOrdersFromBulkLines(
  lines: BulkOrderLine[],
): Map<string, boolean | null> {
  const result = new Map<string, boolean | null>();
  // earliest line per customer: { orderTail, createdAt }
  const best = new Map<string, { tail: string; createdAt: string }>();
  const customerByTail = new Map<string, string>();

  for (const l of lines) {
    const tail = gidTail(l.id);
    const custId = l.customer?.id ? gidTail(l.customer.id) : null;
    if (!custId) {
      result.set(tail, null); // guest → unclassifiable
      continue;
    }
    customerByTail.set(tail, custId);
    const cur = best.get(custId);
    const isEarlier =
      !cur ||
      l.createdAt < cur.createdAt ||
      (l.createdAt === cur.createdAt && tail < cur.tail);
    if (isEarlier) best.set(custId, { tail, createdAt: l.createdAt });
  }

  for (const [tail, custId] of customerByTail) {
    const winner = best.get(custId);
    result.set(tail, winner != null && winner.tail === tail);
  }
  return result;
}

/**
 * Pure resolver: Bulk lines → one earliest-order row per customer, shaped for
 * the `customer_first_order` ledger seed (Phase 3 full-history backfill).
 *
 * For each (customer) it picks the earliest order — MIN createdAt, with the
 * smallest order-id tail as a deterministic lexicographic tiebreak (matching
 * resolveFirstOrdersFromBulkLines). Guest lines (no customer id) are SKIPPED
 * entirely: the ledger is keyed by customer, so a guest has nowhere to live.
 *
 * Output ids are gidTail-normalized (numeric tails) so they match the REST
 * order_id / customer_id tails already stored in orders_attribution.
 */
export function resolveCustomerFirstOrders(
  lines: BulkOrderLine[],
): { customerId: string; firstOrderId: string; firstCreatedAt: string }[] {
  // earliest line per customer: { orderTail, createdAt }
  const best = new Map<string, { tail: string; createdAt: string }>();

  for (const l of lines) {
    const custId = l.customer?.id ? gidTail(l.customer.id) : null;
    if (!custId) continue; // guest → no ledger row
    const tail = gidTail(l.id);
    const cur = best.get(custId);
    const isEarlier =
      !cur ||
      l.createdAt < cur.createdAt ||
      (l.createdAt === cur.createdAt && tail < cur.tail);
    if (isEarlier) best.set(custId, { tail, createdAt: l.createdAt });
  }

  const out: { customerId: string; firstOrderId: string; firstCreatedAt: string }[] = [];
  for (const [customerId, winner] of best) {
    out.push({
      customerId,
      firstOrderId: winner.tail,
      firstCreatedAt: winner.createdAt,
    });
  }
  return out;
}

/** Kick off the Bulk export; returns the bulk operation gid. Throws on userErrors. */
export async function startBulkFirstOrderExport(storeId: string): Promise<string> {
  const domain = requireDomain(storeId);
  const token = await getShopifyAccessToken(storeId);
  const res = await fetchWithBackoff(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: BULK_FIRST_ORDER_QUERY }),
    },
    { provider: 'shopify' },
  );
  if (!res.ok) {
    throw new Error(`bulk start ${storeId} failed (${res.status})`);
  }
  const body = (await res.json()) as {
    data?: { bulkOperationRunQuery?: { bulkOperation?: { id?: string }; userErrors?: Array<{ message?: string }> } };
  };
  const errs = body.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length > 0) {
    throw new Error(`bulk start ${storeId} userErrors: ${errs.map((e) => e.message).join('; ')}`);
  }
  const id = body.data?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!id) throw new Error(`bulk start ${storeId}: no operation id returned`);
  return id;
}

/** Poll currentBulkOperation until COMPLETED; returns the NDJSON download URL. */
export async function pollBulkFirstOrderUrl(
  storeId: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<string> {
  const domain = requireDomain(storeId);
  const token = await getShopifyAccessToken(storeId);
  const intervalMs = opts.intervalMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 120;
  const POLL = `query { currentBulkOperation { id status errorCode url } }`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchWithBackoff(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: POLL }),
      },
      { provider: 'shopify' },
    );
    const body = (await res.json()) as {
      data?: { currentBulkOperation?: { status?: string; errorCode?: string | null; url?: string | null } };
    };
    const op = body.data?.currentBulkOperation;
    if (op?.status === 'COMPLETED') {
      if (!op.url) return ''; // COMPLETED with 0 rows → no file
      return op.url;
    }
    if (op?.status === 'FAILED') {
      throw new Error(`bulk ${storeId} FAILED: ${op.errorCode ?? 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`bulk ${storeId}: poll timed out after ${maxAttempts} attempts`);
}

/** Download + parse + resolve. Empty url → empty map (store had 0 orders). */
export async function runBulkFirstOrderBackfill(
  storeId: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<Map<string, boolean | null>> {
  await startBulkFirstOrderExport(storeId);
  const url = await pollBulkFirstOrderUrl(storeId, opts);
  if (!url) return new Map();
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) throw new Error(`bulk ${storeId} download failed (${res.status})`);
  const ndjson = await res.text();
  return resolveFirstOrdersFromBulkLines(parseBulkNdjson(ndjson));
}

function requireDomain(storeId: string): string {
  const key = `${storeId.toUpperCase()}_SHOPIFY_DOMAIN`;
  const domain = process.env[key];
  if (!domain) throw new Error(`shopifyBulkFirstOrder: missing env ${key}`);
  return domain;
}

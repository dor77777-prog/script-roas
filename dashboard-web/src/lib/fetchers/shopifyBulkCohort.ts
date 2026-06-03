/**
 * Wave 2 — full-history Shopify Bulk-Operations cohort export.
 *
 * READ-ONLY toward Shopify; ZERO writes to ad platforms (CAPI-safe). Exports
 * per order:
 *   { id, createdAt, customer{id},
 *     currentTotalPriceSet{shopMoney{amount,currencyCode}} (gross),
 *     totalRefundedSet{shopMoney{amount}} (refunds) }
 * via bulkOperationRunQuery → poll currentBulkOperation → download NDJSON →
 * parseBulkCohortNdjson → caller converts gross/net to CAD (cadConvert),
 * joins each order to its customer's first_order_month (ledger), and folds
 * into customer_cohort_monthly cells (aggregateCohortCells).
 *
 * Privacy: only customer.id (opaque) is requested — never name/email/phone.
 *
 * Mirrors shopifyBulkFirstOrder.ts: the network functions are thin; the
 * parser is pure and unit-tested. The seed runner + weekly cron wire the
 * network helpers to a Supabase admin client per store.
 */
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';
import { fetchWithBackoff } from './withBackoff';

const SHOPIFY_API_VERSION = '2026-04';

/** One exported order line from the cohort Bulk NDJSON. */
export type BulkCohortOrderLine = {
  id: string;
  createdAt: string;
  customer: { id?: string | null } | null;
  currentTotalPriceSet?: { shopMoney?: { amount?: string | null; currencyCode?: string | null } | null } | null;
  totalRefundedSet?: { shopMoney?: { amount?: string | null } | null } | null;
};

/** Parsed cohort row in NATIVE currency (CAD conversion happens downstream). */
export type BulkCohortRow = {
  orderId: string;
  createdAt: string;
  customerId: string | null;
  grossNative: number;
  refundNative: number;
  currency: string | null;
};

/**
 * GraphQL document exporting per order {id, createdAt, customer{id}, gross,
 * refunds, currency} for ALL orders.
 */
export const BULK_COHORT_QUERY = `
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
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount } }
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

/** Coerce a Shopify money "amount" string → number (0 on null/NaN). */
function toAmount(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse cohort Bulk NDJSON text → BulkCohortRow[] (skips blanks + malformed
 * lines). Order/customer ids are gidTail-normalized (numeric tails). Guest
 * lines (no customer id) keep customerId = null — the aggregator decides what
 * to do with them. Amounts are in the order's native currency.
 */
export function parseBulkCohortNdjson(ndjson: string): BulkCohortRow[] {
  const out: BulkCohortRow[] = [];
  for (const raw of ndjson.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as BulkCohortOrderLine;
      if (typeof obj.id !== 'string' || typeof obj.createdAt !== 'string') continue;
      const custGid = obj.customer && typeof obj.customer === 'object' ? obj.customer.id : null;
      out.push({
        orderId: gidTail(obj.id),
        createdAt: obj.createdAt,
        customerId: custGid ? gidTail(custGid) : null,
        grossNative: toAmount(obj.currentTotalPriceSet?.shopMoney?.amount),
        refundNative: toAmount(obj.totalRefundedSet?.shopMoney?.amount),
        currency: obj.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      });
    } catch {
      // malformed line — skip (one bad row must not abort the batch)
    }
  }
  return out;
}

/** Kick off the cohort Bulk export; returns the bulk operation gid. Throws on userErrors. */
export async function startBulkCohortExport(storeId: string): Promise<string> {
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
      body: JSON.stringify({ query: BULK_COHORT_QUERY }),
    },
    { provider: 'shopify' },
  );
  if (!res.ok) {
    throw new Error(`bulk cohort start ${storeId} failed (${res.status})`);
  }
  const body = (await res.json()) as {
    data?: { bulkOperationRunQuery?: { bulkOperation?: { id?: string }; userErrors?: Array<{ message?: string }> } };
  };
  const errs = body.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length > 0) {
    throw new Error(`bulk cohort start ${storeId} userErrors: ${errs.map((e) => e.message).join('; ')}`);
  }
  const id = body.data?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!id) throw new Error(`bulk cohort start ${storeId}: no operation id returned`);
  return id;
}

/** Poll currentBulkOperation until COMPLETED; returns the NDJSON download URL. */
export async function pollBulkCohortUrl(
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
      throw new Error(`bulk cohort ${storeId} FAILED: ${op.errorCode ?? 'unknown'}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`bulk cohort ${storeId}: poll timed out after ${maxAttempts} attempts`);
}

/** Download + parse. Empty url → empty array (store had 0 orders). */
export async function runBulkCohortExport(
  storeId: string,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<BulkCohortRow[]> {
  await startBulkCohortExport(storeId);
  const url = await pollBulkCohortUrl(storeId, opts);
  if (!url) return [];
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) throw new Error(`bulk cohort ${storeId} download failed (${res.status})`);
  const ndjson = await res.text();
  return parseBulkCohortNdjson(ndjson);
}

function requireDomain(storeId: string): string {
  const key = `${storeId.toUpperCase()}_SHOPIFY_DOMAIN`;
  const domain = process.env[key];
  if (!domain) throw new Error(`shopifyBulkCohort: missing env ${key}`);
  return domain;
}

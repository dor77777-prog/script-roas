#!/usr/bin/env node
// One-off: export ALL customers across the 3 Shopify stores (combined, deduped
// by email) into Facebook Custom-Audience CSVs for a value-based Lookalike.
//
// READ-ONLY toward Shopify (Bulk Operations on `customers`). ZERO writes to ad
// platforms / pixels / CAPI — this is a customer-LIST export the operator
// uploads to Meta themselves; it does NOT emit conversion events, so it does
// NOT touch the CAPI dedup model.
//
// PRIVACY: contains PII (email/phone/name/address). Output is written OUTSIDE
// the repo (OUT_DIR, default ~/fb-audience-export) so it can never be git-added.
// Only customers with marketing consent (email OR sms SUBSCRIBED) are included
// by default (INCLUDE_ALL=1 overrides — only with a lawful basis).
//
// Facebook customer-file schema used (Meta hashes on upload; plaintext is fine):
//   email, phone, fn, ln, ct, st, zip, country, value
// `value` = customer lifetime spend in CAD (summed across stores) — the column
// Meta uses for a VALUE-BASED lookalike. Two extra lists split purchasers by the
// median value (high/low).
//
// RUN (env mapped from the dotted root .env — see /tmp runner):
//   npx tsx scripts/exportCustomersForFacebook.ts
import fs from 'node:fs';
import path from 'node:path';
import { getShopifyAccessToken } from '@/lib/fetchers/shopifyAuth';
import { fetchWithBackoff } from '@/lib/fetchers/withBackoff';
import { getFxRate } from '@/lib/fetchers/fx';

const SHOPIFY_API_VERSION = '2026-04';
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;
const OUT_DIR = process.env.OUT_DIR || path.join(process.env.HOME || '/tmp', 'fb-audience-export');
const INCLUDE_ALL = process.env.INCLUDE_ALL === '1';

const BULK_CUSTOMERS_QUERY = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      customers {
        edges {
          node {
            id
            email
            phone
            firstName
            lastName
            numberOfOrders
            amountSpent { amount currencyCode }
            emailMarketingConsent { marketingState }
            smsMarketingConsent { marketingState }
            defaultAddress { city provinceCode zip countryCodeV2 phone }
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

type RawCustomer = {
  id?: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  numberOfOrders?: string | null;
  amountSpent?: { amount?: string | null; currencyCode?: string | null } | null;
  emailMarketingConsent?: { marketingState?: string | null } | null;
  smsMarketingConsent?: { marketingState?: string | null } | null;
  defaultAddress?: { city?: string | null; provinceCode?: string | null; zip?: string | null; countryCodeV2?: string | null; phone?: string | null } | null;
};

function requireDomain(storeId: string): string {
  const key = `${storeId.toUpperCase()}_SHOPIFY_DOMAIN`;
  const d = process.env[key];
  if (!d) throw new Error(`missing env ${key}`);
  return d;
}

async function gql(storeId: string, query: string): Promise<unknown> {
  const domain = requireDomain(storeId);
  const token = await getShopifyAccessToken(storeId);
  const res = await fetchWithBackoff(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
    },
    { provider: 'shopify' },
  );
  if (!res.ok) throw new Error(`gql ${storeId} HTTP ${res.status}`);
  return res.json();
}

async function runBulkCustomers(storeId: string): Promise<RawCustomer[]> {
  const start = (await gql(storeId, BULK_CUSTOMERS_QUERY)) as {
    data?: { bulkOperationRunQuery?: { bulkOperation?: { id?: string }; userErrors?: Array<{ message?: string }> } };
  };
  const errs = start.data?.bulkOperationRunQuery?.userErrors ?? [];
  if (errs.length) throw new Error(`${storeId} bulk start userErrors: ${errs.map((e) => e.message).join('; ')}`);
  if (!start.data?.bulkOperationRunQuery?.bulkOperation?.id) throw new Error(`${storeId}: no bulk op id`);

  // poll
  let url = '';
  for (let i = 0; i < 240; i++) {
    const poll = (await gql(storeId, `query { currentBulkOperation { status errorCode url objectCount } }`)) as {
      data?: { currentBulkOperation?: { status?: string; errorCode?: string | null; url?: string | null; objectCount?: string } };
    };
    const op = poll.data?.currentBulkOperation;
    if (op?.status === 'COMPLETED') { url = op.url ?? ''; process.stdout.write(`  ${storeId}: ${op.objectCount ?? '?'} customers\n`); break; }
    if (op?.status === 'FAILED') throw new Error(`${storeId} bulk FAILED: ${op.errorCode ?? 'unknown'}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!url) return [];
  const res = await fetchWithBackoff(url, { method: 'GET' }, { provider: 'shopify' });
  if (!res.ok) throw new Error(`${storeId} download HTTP ${res.status}`);
  const ndjson = await res.text();
  const out: RawCustomer[] = [];
  for (const raw of ndjson.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try { out.push(JSON.parse(line) as RawCustomer); } catch { /* skip malformed */ }
  }
  return out;
}

// FX cache (currency → CAD rate at today).
const today = new Date().toISOString().slice(0, 10);
const fxCache = new Map<string, number>();
async function toCad(amount: number, currency: string): Promise<number> {
  const cur = (currency || 'CAD').toUpperCase();
  if (cur === 'CAD') return amount;
  if (!fxCache.has(cur)) {
    try { fxCache.set(cur, await getFxRate(cur as 'USD' | 'ILS' | 'CAD', 'CAD', today)); }
    catch { fxCache.set(cur, 0); }
  }
  const r = fxCache.get(cur)!;
  return Number.isFinite(r) && r > 0 ? amount * r : amount; // FX-fail → keep native (rare)
}

type Merged = {
  email: string; phone: string; fn: string; ln: string;
  ct: string; st: string; zip: string; country: string;
  value: number; orders: number; stores: Set<string>;
};

function csvCell(s: string | number): string {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ISO 3166-1 alpha-2 → international dialing code (the countries seen in the
// data + common fallbacks). Used to lift national numbers to E.164.
const DIAL: Record<string, string> = {
  IL: '972', US: '1', CA: '1', GB: '44', CZ: '420', NL: '31',
  DE: '49', FR: '33', AU: '61', IT: '39', ES: '34', BE: '32', IE: '353',
};

/**
 * Normalize a phone to strict E.164 (+[country code][number]) — required by
 * BOTH Meta and TikTok customer files. Uses the row's country to lift national
 * numbers (e.g. IL "052-688-8514" → "+972526888514"). Returns '' when it can't
 * produce a plausible E.164 (8–15 digits) so invalid values are dropped, not
 * uploaded as garbage. Defaults unknown-country national numbers to IL (≈96% of
 * the base) only when they look Israeli (leading 0 / 972).
 */
function normalizePhoneE164(raw: string, country: string): string {
  if (!raw) return '';
  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (hadPlus) {
    // already international — digits include the country code
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else {
    const cc = (country || '').toUpperCase();
    const dial = DIAL[cc] || (digits.startsWith('972') || digits.startsWith('0') ? '972' : '');
    if (!dial) return ''; // unknown country + bare national number → can't safely guess
    if (digits.startsWith('0')) digits = dial + digits.slice(1);
    else if (digits.startsWith(dial)) { /* already carries the country code */ }
    else digits = dial + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? '+' + digits : '';
}

/**
 * Clean an email: lowercase, trim, strip leading junk (Meta flagged values like
 * "וrnavot1@…" / "هوnatheramara490@…" / "???avirefael123@…" — a non-ASCII or
 * punctuation prefix before the real local part). Returns '' when the result
 * isn't a plausible email so it's dropped rather than uploaded invalid.
 */
function cleanEmail(raw: string): string {
  let s = (raw || '').trim().toLowerCase();
  s = s.replace(/^[^a-z0-9]+/, ''); // drop a leading junk prefix
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const byKey = new Map<string, Merged>();
  let totalRaw = 0, consented = 0, noContact = 0;

  for (const store of STORES) {
    process.stdout.write(`--- ${store} ---\n`);
    const customers = await runBulkCustomers(store);
    totalRaw += customers.length;
    for (const c of customers) {
      const a = c.defaultAddress || {};
      const country = (a.countryCodeV2 || '').trim().toUpperCase();
      const email = cleanEmail(c.email || '');
      // Shopify rarely sets the top-level customer.phone; fall back to the
      // address phone, then normalize to E.164 (Meta + TikTok require it).
      const phone = normalizePhoneE164((c.phone || a.phone || '').trim(), country);
      const emailOk = c.emailMarketingConsent?.marketingState === 'SUBSCRIBED';
      const smsOk = c.smsMarketingConsent?.marketingState === 'SUBSCRIBED';
      if (!INCLUDE_ALL && !emailOk && !smsOk) continue;
      consented++;
      const key = email || phone;
      if (!key) { noContact++; continue; }
      const valueCad = await toCad(Number(c.amountSpent?.amount ?? 0) || 0, c.amountSpent?.currencyCode || 'CAD');
      const orders = Number(c.numberOfOrders ?? 0) || 0;
      const prev = byKey.get(key);
      if (prev) {
        prev.value += valueCad;
        prev.orders += orders;
        prev.stores.add(store);
        // fill any blank PII from this record
        prev.email ||= email; prev.phone ||= phone;
        prev.fn ||= (c.firstName || '').trim(); prev.ln ||= (c.lastName || '').trim();
        prev.ct ||= (a.city || '').trim(); prev.st ||= (a.provinceCode || '').trim();
        prev.zip ||= (a.zip || '').trim(); prev.country ||= country;
      } else {
        byKey.set(key, {
          email, phone,
          fn: (c.firstName || '').trim(), ln: (c.lastName || '').trim(),
          ct: (a.city || '').trim(), st: (a.provinceCode || '').trim(),
          zip: (a.zip || '').trim(), country,
          value: valueCad, orders, stores: new Set([store]),
        });
      }
    }
  }

  const all = [...byKey.values()].map((m) => ({ ...m, value: Math.round(m.value * 100) / 100 }));
  const HEADER = 'email,phone,fn,ln,ct,st,zip,country,value';
  const row = (m: Merged) => [m.email, m.phone, m.fn, m.ln, m.ct, m.st, m.zip, m.country, m.value].map(csvCell).join(',');
  const write = (name: string, rows: Merged[]) => {
    fs.writeFileSync(path.join(OUT_DIR, name), [HEADER, ...rows.map(row)].join('\n') + '\n');
    return rows.length;
  };

  // Purchasers (value > 0) drive the value-based lookalike; split at a fixed
  // CAD threshold (operator-set: high = ≥ $100 CAD). Override via env.
  const THRESHOLD = Number(process.env.HIGH_VALUE_THRESHOLD || 100);
  const purchasers = all.filter((m) => m.value > 0).sort((a, b) => b.value - a.value);
  const high = purchasers.filter((m) => m.value >= THRESHOLD);
  const low = purchasers.filter((m) => m.value < THRESHOLD);
  const noBuy = all.filter((m) => m.value <= 0); // consented, never purchased → remarketing list

  const nAll = write('customers_all_consented.csv', all);
  const nNoBuy = write('customers_consented_no_purchase.csv', noBuy);
  const nHigh = write('customers_high_value.csv', high);
  const nLow = write('customers_low_value.csv', low);

  // TikTok custom-audience files — TikTok matches on Email / Phone (E.164) /
  // device-id only; it ignores name/address/value. Lean Email+Phone files, in a
  // tiktok/ subfolder, same 4 splits. (Per https://ads.tiktok.com/help/article/
  // how-to-create-a-custom-audience-with-a-customer-file — the uploader maps the
  // columns + hashes server-side, like Meta.)
  const ttDir = path.join(OUT_DIR, 'tiktok');
  fs.mkdirSync(ttDir, { recursive: true });
  const ttRow = (m: Merged) => [m.email, m.phone].map(csvCell).join(',');
  const writeTikTok = (name: string, rows: Merged[]) =>
    fs.writeFileSync(path.join(ttDir, name), ['email,phone', ...rows.map(ttRow)].join('\n') + '\n');
  writeTikTok('customers_all_consented.csv', all);
  writeTikTok('customers_consented_no_purchase.csv', noBuy);
  writeTikTok('customers_high_value.csv', high);
  writeTikTok('customers_low_value.csv', low);

  process.stdout.write('\n=== SUMMARY ===\n');
  process.stdout.write(`raw customers pulled (all stores):   ${totalRaw}\n`);
  process.stdout.write(`marketing-consented:                 ${consented}${INCLUDE_ALL ? ' (INCLUDE_ALL=1: consent filter OFF)' : ''}\n`);
  process.stdout.write(`unique after email/phone dedupe:     ${nAll}\n`);
  process.stdout.write(`  · purchasers (value>0):            ${purchasers.length}\n`);
  process.stdout.write(`  · skipped (no email & no phone):   ${noContact}\n`);
  process.stdout.write(`high-value threshold (CAD):          $${THRESHOLD}\n`);
  process.stdout.write(`high-value list (≥ $${THRESHOLD}):           ${nHigh}\n`);
  process.stdout.write(`low-value list (< $${THRESHOLD}, >0):        ${nLow}\n`);
  process.stdout.write(`consented, never purchased:          ${nNoBuy}\n`);
  process.stdout.write(`email valid:                         ${all.filter((m) => m.email).length} (${(all.filter((m) => m.email).length / Math.max(1, all.length) * 100).toFixed(1)}%)\n`);
  process.stdout.write(`phone valid (E.164):                 ${all.filter((m) => m.phone).length} (${(all.filter((m) => m.phone).length / Math.max(1, all.length) * 100).toFixed(1)}%)\n`);
  process.stdout.write(`FX rates used (→CAD):                ${[...fxCache.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || '(all CAD)'}\n`);
  process.stdout.write(`\nFiles: ${OUT_DIR}  (Meta) + ${OUT_DIR}/tiktok  (TikTok email+phone)\n`);
}

main().catch((e) => { console.error('EXPORT FAILED:', e); process.exit(1); });

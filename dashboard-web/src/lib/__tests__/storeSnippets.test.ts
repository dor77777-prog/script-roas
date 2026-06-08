// dashboard-web/src/lib/__tests__/storeSnippets.test.ts
//
// Self-serve stores Phase 6a, Task 2 — pure store-snippet generator.
//
// `generateStoreSnippet` is a PURE function: given a store's identity, its
// minted `cartPublicToken`, allowed origins, and whether it's headless, it
// returns the operator-facing storefront snippet(s) to paste. The snippet
// text is copied VERBATIM from docs/storefront-snippets/first-touch-attribution.md
// — the only substitution is the token (themed) / the env-var note (headless).
//
// These tests pin the two critical invariants:
//   - themed: the token + the production cart endpoint + the API field names
//     are present; the placeholder string is fully substituted out.
//   - headless: the token NEVER appears in the client JS; the note carries
//     the token + the ROAS_STORE_TOKEN edge-function env-var name.

import { describe, expect, it } from 'vitest';
import { generateStoreSnippet } from '@/lib/storeSnippets';

const TOKEN = 'tEsT_cArT_tOkEn_abc123XYZ';
const PLACEHOLDER = '<STORE_CART_TOKEN>';
const PROD_CART_ENDPOINT = 'https://roas-dashboard-smoky.vercel.app/api/events/cart';

describe('generateStoreSnippet — themed (Shopify Custom Pixel)', () => {
  const result = generateStoreSnippet({
    storeId: 'uzoshop',
    cartPublicToken: TOKEN,
    allowedOrigins: ['https://uzoshop.com'],
    isHeadless: false,
  });

  it('returns kind === "themed"', () => {
    expect(result.kind).toBe('themed');
  });

  it('primary contains the minted cartPublicToken', () => {
    expect(result.primary).toContain(TOKEN);
  });

  it('primary substitutes the placeholder token out entirely', () => {
    expect(result.primary).not.toContain(PLACEHOLDER);
  });

  it('primary uses the production cart endpoint (never localhost)', () => {
    expect(result.primary).toContain(PROD_CART_ENDPOINT);
    expect(result.primary).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('primary POST body carries the required API field names', () => {
    expect(result.primary).toContain('store_token');
    expect(result.primary).toContain('event_id');
    // optional fields the API also accepts
    expect(result.primary).toContain('product_title');
    expect(result.primary).toContain('quantity');
    expect(result.primary).toContain('occurred_at');
    expect(result.primary).toContain('landing_site');
  });

  it('primary wires the token through the CART_TOKEN const, not a literal in the body', () => {
    expect(result.primary).toContain(`const CART_TOKEN = "${TOKEN}"`);
    expect(result.primary).toContain('store_token: CART_TOKEN');
  });

  it('captures first-touch into the _ft_attr key', () => {
    expect(result.primary).toContain('_ft_attr');
    expect(result.primary).toContain('page_viewed');
    expect(result.primary).toContain('product_added_to_cart');
  });

  it('reads the stored _ft_attr bag and SENDS it as a first_touch field in the POST body', () => {
    // The beacon must READ the first-touch bag (the same _ft_attr key the
    // page_viewed handler persists) AND include it in the cart POST body so the
    // route can compute firstTouchSource (classify-v2 T4b).
    expect(result.primary).toContain('first_touch');
    // It reads from the persisted store, not just re-reads the current URL.
    expect(result.primary).toMatch(/getItem\(["']_ft_attr["']\)/);
  });

  it('note points the operator to the Shopify Custom Pixel screen', () => {
    expect(result.note).toBeDefined();
    expect(result.note).toContain('Customer events');
    expect(result.note).toContain('custom pixel');
  });

  it('themed has no secondary snippet', () => {
    expect(result.secondary).toBeUndefined();
  });
});

describe('generateStoreSnippet — headless (Lovable client + edge function)', () => {
  const result = generateStoreSnippet({
    storeId: 'usmile360',
    cartPublicToken: TOKEN,
    allowedOrigins: ['https://usmile360.com'],
    isHeadless: true,
  });

  it('returns kind === "headless"', () => {
    expect(result.kind).toBe('headless');
  });

  it('primary (client JS) NEVER contains the token', () => {
    expect(result.primary).not.toContain(TOKEN);
  });

  it('primary captures first-touch into localStorage _ft_attr', () => {
    expect(result.primary).toContain('_ft_attr');
    expect(result.primary).toContain('localStorage');
  });

  it('primary (client) documents sending the _ft_attr bag as a first_touch field', () => {
    // The headless client must forward the stored first-touch bag to the edge
    // function as a `first_touch` field (classify-v2 T4b).
    expect(result.primary).toContain('first_touch');
    expect(result.primary).toContain('_ft_attr');
  });

  it('secondary edge function forwards first_touch to /api/events/cart', () => {
    expect(result.secondary).toContain('first_touch');
  });

  it('note instructs setting ROAS_STORE_TOKEN to the token in the edge function env', () => {
    expect(result.note).toBeDefined();
    expect(result.note).toContain('ROAS_STORE_TOKEN');
    expect(result.note).toContain(TOKEN);
    expect(result.note).toContain('roas-cart-event');
  });

  it('secondary holds the edge-function (server-side token) snippet', () => {
    expect(result.secondary).toBeDefined();
    expect(result.secondary).toContain('ROAS_STORE_TOKEN');
    expect(result.secondary).toContain('store_token');
    expect(result.secondary).toContain('landing_site');
  });

  it('secondary keeps the token server-side (no client literal token)', () => {
    expect(result.secondary).not.toContain(TOKEN);
    expect(result.secondary).toContain('Deno.env.get');
  });
});

describe('generateStoreSnippet — purity / determinism', () => {
  it('is deterministic: same args → identical output', () => {
    const args = {
      storeId: 'uzoshop',
      cartPublicToken: TOKEN,
      allowedOrigins: ['https://uzoshop.com'],
      isHeadless: false,
    };
    expect(generateStoreSnippet(args)).toEqual(generateStoreSnippet(args));
  });

  it('different tokens produce different themed primaries', () => {
    const a = generateStoreSnippet({
      storeId: 'uzoshop',
      cartPublicToken: 'token-a',
      allowedOrigins: [],
      isHeadless: false,
    });
    const b = generateStoreSnippet({
      storeId: 'uzoshop',
      cartPublicToken: 'token-b',
      allowedOrigins: [],
      isHeadless: false,
    });
    expect(a.primary).not.toEqual(b.primary);
  });
});

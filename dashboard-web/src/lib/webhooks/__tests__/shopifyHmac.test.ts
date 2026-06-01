import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyShopifyHmac } from '../shopifyHmac';

const secret = 'shpss_test_secret';
const body = '{"id":123,"total_price":"50.00"}';
const goodSig = createHmac('sha256', secret).update(body, 'utf8').digest('base64');

describe('verifyShopifyHmac', () => {
  it('accepts a correct signature', () => {
    expect(verifyShopifyHmac(body, goodSig, secret)).toBe(true);
  });
  it('rejects a wrong signature', () => {
    expect(verifyShopifyHmac(body, 'AAAA', secret)).toBe(false);
  });
  it('rejects when secret is empty/null', () => {
    expect(verifyShopifyHmac(body, goodSig, '')).toBe(false);
  });
  it('rejects a tampered body', () => {
    expect(verifyShopifyHmac(body + ' ', goodSig, secret)).toBe(false);
  });
});

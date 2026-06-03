import { describe, expect, it } from 'vitest';
import { categorizePaymentGateway, primaryGateway } from '@/lib/payments';

describe('categorizePaymentGateway', () => {
  it('paypal variants → paypal', () => {
    for (const g of ['paypal', 'paypal_express', 'PayPal Express Checkout'])
      expect(categorizePaymentGateway(g)).toBe('paypal');
  });
  it('card gateways → credit', () => {
    for (const g of ['shopify_payments', 'stripe', 'bogus', 'Visa', 'mastercard'])
      expect(categorizePaymentGateway(g)).toBe('credit');
  });
  it('gift_card/manual/cod/null → other', () => {
    for (const g of ['gift_card', 'manual', 'Cash on Delivery (COD)', null, ''])
      expect(categorizePaymentGateway(g as string | null)).toBe('other');
  });
});

describe('primaryGateway', () => {
  it('prefers the non-gift_card/manual name', () => {
    expect(primaryGateway(['gift_card', 'shopify_payments'])).toBe('shopify_payments');
  });
  it('falls back to first when all are secondary', () => {
    expect(primaryGateway(['gift_card'])).toBe('gift_card');
  });
  it('empty/undefined → null', () => {
    expect(primaryGateway([])).toBeNull();
    expect(primaryGateway(undefined)).toBeNull();
  });
});

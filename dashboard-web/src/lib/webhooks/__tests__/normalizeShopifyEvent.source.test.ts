import { describe, it, expect } from 'vitest';
import { normalizeOrderEvent } from '@/lib/webhooks/normalizeShopifyEvent';

const fx = async () => 1; // FX fetcher stub; not under test here

describe('normalizeOrderEvent — source', () => {
  it('classifies a Meta sale from landing_site fbclid', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '100', currency: 'CAD', created_at: '2026-06-06T10:00:00Z',
      landing_site: '/?fbclid=abc123', line_items: [{ title: 'X', quantity: 1 }],
    }, { storeId: 'uzoshop', webhookId: 'w1', cadConvert: fx });
    expect(ev?.source).toBe('meta-paid');
  });
  it('classifies a Google sale from gclid', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '50', currency: 'CAD', created_at: '2026-06-06T10:00:00Z',
      landing_site: '/?gclid=xyz', line_items: [],
    }, { storeId: 'uzoshop', webhookId: 'w2', cadConvert: fx });
    expect(ev?.source).toBe('google-paid');
  });
  it('direct sale with no signals → "direct"', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '20', currency: 'CAD', created_at: '2026-06-06T10:00:00Z', landing_site: '/',
    }, { storeId: 'uzoshop', webhookId: 'w3', cadConvert: fx });
    expect(ev?.source).toBe('direct');
  });
  it('refund sets source null', async () => {
    const ev = await normalizeOrderEvent('refund', {
      id: 1, created_at: '2026-06-06T10:00:00Z', transactions: [{ amount: '10', currency: 'CAD' }],
    }, { storeId: 'uzoshop', webhookId: 'w4', cadConvert: fx });
    expect(ev).not.toBeNull();
    expect(ev!.source).toBeNull();
  });
  it('classifies a TikTok sale from ttclid', async () => {
    const ev = await normalizeOrderEvent('sale', {
      total_price: '75', currency: 'CAD', created_at: '2026-06-06T10:00:00Z',
      landing_site: '/?ttclid=tk_123', line_items: [],
    }, { storeId: 'uzoshop', webhookId: 'w5', cadConvert: fx });
    expect(ev?.source).toBe('tiktok-paid');
  });
});

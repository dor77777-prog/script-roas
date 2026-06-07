import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoreInfo } from '@/lib/getStores';

// Mock the DB boundary (getStores) so the suite stays hermetic — the route's
// job is just to wrap getStores() in { stores } JSON with the cache header.
const mock = vi.hoisted(() => ({ stores: [] as StoreInfo[] }));
vi.mock('@/lib/getStores', () => ({ getStores: () => Promise.resolve(mock.stores) }));

import { GET } from '../route';

const SAMPLE: StoreInfo[] = [
  { storeId: 'uzoshop', storeName: 'uzoshop', brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true, status: 'active', displayOrder: 1 },
  { storeId: 'newstore', storeName: 'New Store', brandColor: 'var(--store-4)', isHeadless: true, hasTikTok: false, status: 'active', displayOrder: 4 },
];

beforeEach(() => { mock.stores = SAMPLE; });

describe('GET /api/stores', () => {
  it('returns { stores } from getStores', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.stores).toEqual(SAMPLE);
  });

  it('sets a Cache-Control header', async () => {
    const res = await GET();
    expect(res.headers.get('Cache-Control')).toBeTruthy();
  });

  it('passes through an empty list (all-archived → []) without resurrecting fallback', async () => {
    mock.stores = [];
    const res = await GET();
    const body = await res.json();
    expect(body.stores).toEqual([]);
  });
});

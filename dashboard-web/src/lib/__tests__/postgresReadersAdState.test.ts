import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        range: () => Promise.resolve({ data: rows.data, error: null }),
      };
      return q;
    },
  }),
}));

import { fetchAdStateFromPostgres } from '@/lib/postgresReaders';

beforeEach(() => { rows.data = []; });

describe('fetchAdStateFromPostgres', () => {
  it('returns an empty map when there are no rows (⇒ all ON)', async () => {
    expect(await fetchAdStateFromPostgres()).toEqual({});
  });
  it('maps rows to `${store}:${platform}` → enabled', async () => {
    rows.data = [
      { store_id: 'zolplus', platform: 'meta', enabled: false },
      { store_id: 'uzoshop', platform: 'google', enabled: true },
    ];
    expect(await fetchAdStateFromPostgres()).toEqual({
      'zolplus:meta': false,
      'uzoshop:google': true,
    });
  });
});

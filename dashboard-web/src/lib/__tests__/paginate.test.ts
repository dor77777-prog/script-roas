import { describe, it, expect } from 'vitest';
import { paginate } from '@/lib/postgresReaders';

/**
 * paginate() bypasses Supabase Cloud's db-max-rows=1000 cap by looping
 * .range() chunks. The bug it guards against: WITHOUT a deterministic ORDER BY,
 * Postgres can return rows in a different order between the .range(0..999) and
 * .range(1000..1999) calls → rows duplicated on one page and skipped on another
 * (corrupting every downstream aggregate). `orderBy` is therefore a REQUIRED
 * parameter (TypeScript enforces presence at every call site) and must be the
 * table's unique key. These tests pin that the key is applied on EVERY chunk.
 */

/** A fake supabase query builder that records the .order() columns per chunk
 *  and returns the queued pages from .range(). */
function makeBuildQuery(pages: unknown[][], orderLog: string[][]) {
  return () => {
    const thisChunk: string[] = [];
    orderLog.push(thisChunk);
    const q: Record<string, unknown> = {
      order(col: string) {
        thisChunk.push(col);
        return q;
      },
      range() {
        return Promise.resolve({ data: pages.shift() ?? [], error: null });
      },
    };
    return q;
  };
}

describe('paginate — deterministic pagination', () => {
  it('applies the full orderBy key on EVERY chunk and concatenates pages', async () => {
    const orderLog: string[][] = [];
    const pages = [new Array(1000).fill({ n: 1 }), new Array(3).fill({ n: 2 })];
    const out = await paginate<{ n: number }>(
      makeBuildQuery(pages, orderLog),
      ['date', 'store_id'],
      1000,
    );
    expect(out).toHaveLength(1003);
    // Two chunks fetched (1000 == chunkSize → keep going; 3 < chunkSize → stop).
    // The unique key is applied on BOTH chunk reads — otherwise pages could
    // overlap/skip.
    expect(orderLog).toEqual([
      ['date', 'store_id'],
      ['date', 'store_id'],
    ]);
  });

  it('stops after the first short page (single chunk)', async () => {
    const orderLog: string[][] = [];
    const out = await paginate<{ n: number }>(
      makeBuildQuery([[{ n: 1 }, { n: 2 }]], orderLog),
      ['id'],
      1000,
    );
    expect(out).toHaveLength(2);
    expect(orderLog).toHaveLength(1);
  });

  it('throws when orderBy is empty (cannot paginate safely without a stable key)', async () => {
    await expect(paginate<unknown>(makeBuildQuery([[]], []), [], 10)).rejects.toThrow(
      /orderBy is required/,
    );
  });

  it('propagates a query error', async () => {
    const errBuild = () => {
      const q: Record<string, unknown> = {
        order: () => q,
        range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      };
      return q;
    };
    await expect(paginate<unknown>(errBuild, ['id'], 10)).rejects.toThrow(/boom/);
  });
});

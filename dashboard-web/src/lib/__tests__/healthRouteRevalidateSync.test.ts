/**
 * Phase 05.5 gap-closure — REVIEW.md WR-05.
 *
 * The /api/health route exports a LITERAL `revalidate = 10` (not the
 * MemberExpression `CACHE_CONFIG.health.revalidate`) because Next.js's
 * static analyzer rejects MemberExpressions for route segment config —
 * see route.ts:19-24 + dashboard-state/route.ts:10 + store-meta/route.ts:10
 * for the same pattern.
 *
 * The literal MUST stay in sync with CACHE_CONFIG.health.revalidate. Without
 * a guard, a future bump to CACHE_CONFIG.health.revalidate could silently
 * diverge from the route literal, leading to a CDN swr=60 + revalidate=10
 * mismatch that the operator can't see from outside.
 *
 * This test enforces the sync. If you bump CACHE_CONFIG.health.revalidate,
 * also bump the literal in route.ts AND update the expected value below.
 */
import { describe, it, expect } from 'vitest';
import { CACHE_CONFIG } from '@/lib/cacheConfig';
import { revalidate as healthRouteRevalidate } from '@/app/api/health/route';

describe('Phase 05.5 — /api/health route segment config sync (WR-05)', () => {
  it('route.ts literal `revalidate` matches CACHE_CONFIG.health.revalidate', () => {
    expect(healthRouteRevalidate).toBe(CACHE_CONFIG.health.revalidate);
  });

  it('CACHE_CONFIG.health is a valid CacheKey entry', () => {
    expect(CACHE_CONFIG.health).toBeDefined();
    expect(typeof CACHE_CONFIG.health.revalidate).toBe('number');
    expect(typeof CACHE_CONFIG.health.swr).toBe('number');
  });

  it('swr is >= revalidate so CDN coalescing has room to operate', () => {
    expect(CACHE_CONFIG.health.swr).toBeGreaterThanOrEqual(CACHE_CONFIG.health.revalidate);
  });
});

/**
 * throwOnErrorBody.test.ts — 2026-06-09 (Task 2)
 *
 * Locks the contract that a 200-with-error body throws (so /api/ads and any
 * other HTTP-200-on-failure route can't masquerade as a legit empty state).
 */
import { describe, expect, it } from 'vitest';
import { throwOnErrorBody } from '@/lib/throwOnErrorBody';

describe('throwOnErrorBody', () => {
  it('throws with the server error message when body.error is present', () => {
    expect(() => throwOnErrorBody({ rows: [], dataLastWriteAt: null, error: 'boom' }))
      .toThrowError('boom');
  });

  it('returns the body unchanged when there is no error (success path)', () => {
    const body = { rows: [{ id: 1 }], dataLastWriteAt: '2026-06-09T00:00:00Z' };
    expect(throwOnErrorBody(body)).toBe(body);
  });

  it('does not throw on an empty-string error (treated as no error)', () => {
    const body = { rows: [], error: '' };
    expect(throwOnErrorBody(body)).toBe(body);
  });
});

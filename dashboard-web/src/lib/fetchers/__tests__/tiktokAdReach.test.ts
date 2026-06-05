// dashboard-web/src/lib/fetchers/__tests__/tiktokAdReach.test.ts
import { describe, it, expect } from 'vitest';
import { parseTikTokAdReach } from '@/lib/fetchers/tiktok';

describe('parseTikTokAdReach', () => {
  it('parses reach from a BASIC report metrics object', () => {
    expect(parseTikTokAdReach({ reach: '650' })).toBe(650);
    expect(parseTikTokAdReach({ reach: 650 })).toBe(650);
  });
  it('returns null when reach is absent', () => {
    expect(parseTikTokAdReach({})).toBeNull();
    expect(parseTikTokAdReach({ reach: undefined })).toBeNull();
  });
});

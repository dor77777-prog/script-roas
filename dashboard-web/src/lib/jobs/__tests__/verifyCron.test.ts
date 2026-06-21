import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyCronRequest } from '../verifyCron';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyCronRequest', () => {
  it('returns true when the bearer matches CRON_SECRET', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t');
    const req = new Request('https://x/api/cron/live', {
      headers: { authorization: 'Bearer s3cr3t' },
    });
    expect(verifyCronRequest(req)).toBe(true);
  });

  it('returns false when the bearer is wrong', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t');
    const req = new Request('https://x/api/cron/live', {
      headers: { authorization: 'Bearer nope' },
    });
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('returns false when there is no Authorization header', () => {
    vi.stubEnv('CRON_SECRET', 's3cr3t');
    const req = new Request('https://x/api/cron/live');
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('with no CRON_SECRET set — returns false unless ALLOW_UNSIGNED_JOBS=1', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('ALLOW_UNSIGNED_JOBS', '');
    const req = new Request('https://x/api/cron/live');
    expect(verifyCronRequest(req)).toBe(false);
  });

  it('with no CRON_SECRET set — returns true when ALLOW_UNSIGNED_JOBS=1', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('ALLOW_UNSIGNED_JOBS', '1');
    const req = new Request('https://x/api/cron/live');
    expect(verifyCronRequest(req)).toBe(true);
  });
});

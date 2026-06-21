import { describe, it, expect, vi } from 'vitest';

describe('workerUrl', () => {
  it('builds an absolute https worker URL from ROAS_BASE_URL', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    const { workerUrl } = await import('../qstash');
    expect(workerUrl('/api/worker/meta')).toBe('https://roas-dashboard-smoky.vercel.app/api/worker/meta');
  });
});

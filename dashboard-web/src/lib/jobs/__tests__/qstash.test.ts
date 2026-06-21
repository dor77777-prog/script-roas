import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the args passed to the @upstash/qstash Client constructor so we can
// assert the region-specific baseUrl (QSTASH_URL) is forwarded.
const clientCtor = vi.fn();
const publishJSON = vi.fn().mockResolvedValue({ messageId: 'm1' });

vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON = publishJSON;
    constructor(opts: unknown) {
      clientCtor(opts);
    }
  },
}));

beforeEach(() => {
  clientCtor.mockClear();
  publishJSON.mockClear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('workerUrl', () => {
  it('builds an absolute https worker URL from ROAS_BASE_URL', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    const { workerUrl } = await import('../qstash');
    expect(workerUrl('/api/worker/meta')).toBe('https://roas-dashboard-smoky.vercel.app/api/worker/meta');
  });
});

describe('QStash Client construction', () => {
  it('passes the region-specific QSTASH_URL as baseUrl when set', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    vi.stubEnv('QSTASH_TOKEN', 'tok_123');
    vi.stubEnv('QSTASH_URL', 'https://eu1.qstash.upstash.io');
    const { publishJob } = await import('../qstash');
    await publishJob('/api/worker/meta', { hello: 'world' });
    expect(clientCtor).toHaveBeenCalledWith({
      token: 'tok_123',
      baseUrl: 'https://eu1.qstash.upstash.io',
    });
  });

  it('leaves baseUrl undefined when QSTASH_URL is unset (Client uses its default)', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    vi.stubEnv('QSTASH_TOKEN', 'tok_123');
    // QSTASH_URL intentionally not stubbed.
    const { publishJob } = await import('../qstash');
    await publishJob('/api/worker/meta', { hello: 'world' });
    expect(clientCtor).toHaveBeenCalledWith({
      token: 'tok_123',
      baseUrl: undefined,
    });
  });

  it('publishJob posts to the absolute workerUrl with retries', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    vi.stubEnv('QSTASH_TOKEN', 'tok_123');
    const { publishJob } = await import('../qstash');
    await publishJob('/api/worker/meta', { a: 1 });
    expect(publishJSON).toHaveBeenCalledWith({
      url: 'https://roas-dashboard-smoky.vercel.app/api/worker/meta',
      body: { a: 1 },
      retries: 3,
    });
  });

  it('throws when QSTASH_TOKEN is not set', async () => {
    vi.stubEnv('ROAS_BASE_URL', 'https://roas-dashboard-smoky.vercel.app');
    // QSTASH_TOKEN intentionally not stubbed.
    const { publishJob } = await import('../qstash');
    await expect(publishJob('/api/worker/meta', {})).rejects.toThrow('QSTASH_TOKEN');
  });
});

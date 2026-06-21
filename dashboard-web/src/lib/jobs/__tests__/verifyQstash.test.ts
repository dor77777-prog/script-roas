import { describe, it, expect } from 'vitest';
import { verifyQstashRequest } from '../verifyQstash';

describe('verifyQstashRequest', () => {
  it('rejects a request with no Upstash-Signature header', async () => {
    const req = new Request('https://x/api/worker/meta', { method: 'POST', body: '{}' });
    const r = await verifyQstashRequest(req);
    expect(r.ok).toBe(false);
  });
});

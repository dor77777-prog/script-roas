import { describe, it, expect } from 'vitest';
import { notifyFxFailure } from '@/lib/notifications/fxFailure';
import type { TokenFailureInput } from '@/lib/notifications/tokenFailures';

describe('notifyFxFailure (DQ-2 — FX outage alert)', () => {
  it('routes through the token-failure alert as provider=fx / store=global / op=fx_rate_failure', async () => {
    const calls: TokenFailureInput[] = [];
    await notifyFxFailure({
      currency: 'USD',
      dateStr: '2026-06-04',
      errorMsg: 'Frankfurter 503',
      notify: async (i) => { calls.push(i); return { sent: true }; },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('fx');
    expect(calls[0].storeId).toBe('global');
    expect(calls[0].operation).toBe('fx_rate_failure');
    expect(calls[0].errorMsg).toContain('USD->CAD');
    expect(calls[0].errorMsg).toContain('Frankfurter 503');
    expect(calls[0].advice).toBeTruthy();
  });

  it('never throws even if the underlying notifier rejects', async () => {
    await expect(
      notifyFxFailure({
        currency: 'ILS',
        dateStr: '2026-06-04',
        errorMsg: 'x',
        notify: async () => { throw new Error('whatsapp down'); },
      }),
    ).resolves.toBeUndefined();
  });
});

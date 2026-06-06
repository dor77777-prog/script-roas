// dashboard-web/src/lib/notifications/__tests__/sendDailySummary.test.ts
//
// Regression test for a/WARN-2: the daily summary orchestrator must throw
// on ANY recipient failure (not only when ALL recipients fail).
//
// Pre-fix: a partial failure (phone1 sent OK, phone2 failed) returned
// successfully — Inngest never retried and the operator only noticed
// when they spot-checked the inbox days later. For the single-recipient
// deployment that's actually live (+972524809540), the original "throw
// only when all fail" semantics never fired even when the lone recipient
// failed silently because of how the per-recipient loop accumulated
// successes alongside failures across cohorts.
//
// Post-fix: ANY entry in `recipientsFailed` triggers a throw. Inngest
// then marks the run failed and retries via its native policy.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---------------------------------------------------------------

const sendMock = vi.fn();
vi.mock('../whatsapp', () => ({
  sendWhatsAppTemplate: (...args: unknown[]) => sendMock(...args),
  loadActiveMetacloudConfig: async () => ({
    phone1: '+972524809540',
    phone2: '+972500000000',
    templateName: 'roas_daily_summary',
    templateLang: 'he',
  }),
}));

vi.mock('../summary', () => ({
  buildStoreSummary: async () => ({
    perStore: [],
    totals: { revenueIls: 0, spendIls: 0, ordersCount: 0, refundsCount: 0 },
  }),
}));

vi.mock('../templateParams', () => ({
  buildTemplateParameters: () => ['p1', 'p2', 'p3', 'p4', 'p5'],
  buildTemplateParametersV2: () => Array.from({ length: 21 }, (_, i) => `v2p${i + 1}`),
  V2_TEMPLATE_NAME: 'roas_daily_summary_v2',
}));

beforeEach(() => {
  sendMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('sendDailySummary (a/WARN-2 — throw on any recipient failure)', () => {
  it('throws when phone1 succeeds but phone2 fails', async () => {
    sendMock
      .mockResolvedValueOnce(undefined) // phone1 OK
      .mockRejectedValueOnce(new Error('132001 template not approved')); // phone2 FAIL

    const { sendDailySummary } = await import('../sendDailySummary');
    await expect(sendDailySummary('2026-05-23', 'titleNoon')).rejects.toThrow(
      /1\/2 WhatsApp recipient\(s\) failed/,
    );
    // Both recipients were attempted (per-recipient loop did NOT bail early).
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('throws when both recipients fail', async () => {
    sendMock
      .mockRejectedValueOnce(new Error('401 unauthorized'))
      .mockRejectedValueOnce(new Error('500 server error'));

    const { sendDailySummary } = await import('../sendDailySummary');
    await expect(sendDailySummary('2026-05-23', 'titleEod')).rejects.toThrow(
      /2\/2 WhatsApp recipient\(s\) failed/,
    );
  });

  it('returns success when all recipients succeed', async () => {
    sendMock.mockResolvedValue(undefined);

    const { sendDailySummary } = await import('../sendDailySummary');
    const result = await sendDailySummary('2026-05-23', 'titleEvening');
    expect(result.skipped).toBe(false);
    expect(result.recipientsSucceeded.length).toBe(2);
    expect(result.recipientsFailed.length).toBe(0);
  });
});

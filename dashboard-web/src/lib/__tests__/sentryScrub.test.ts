// dashboard-web/src/lib/__tests__/sentryScrub.test.ts
// Phase 13.2 — PII scrubber for Sentry beforeSend. Strips refresh tokens,
// access tokens, Bearer values, and phone numbers from event.message,
// event.exception.values[].value, and event.breadcrumbs[].message. Also
// deletes event.request.data when the URL targets /api/operator/*.

import { describe, it, expect } from 'vitest';
import { buildBeforeSend } from '@/lib/sentry/scrub';
import type * as Sentry from '@sentry/nextjs';

const REDACTED = '[REDACTED]';
function makeEvent(overrides: Partial<Sentry.ErrorEvent>): Sentry.ErrorEvent {
  return {
    event_id: 'evt',
    timestamp: Date.now() / 1000,
    platform: 'node',
    ...overrides,
  } as Sentry.ErrorEvent;
}

describe('buildBeforeSend (Phase 13.2 P1-01 PII scrubber)', () => {
  const scrub = buildBeforeSend();

  it('redacts access_token assignments in event.message', () => {
    const out = scrub(makeEvent({ message: 'fetch failed: access_token=secretValue123' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('secretValue123');
  });

  it('redacts refresh_token assignments in event.message', () => {
    const out = scrub(makeEvent({ message: 'oauth payload: "refresh_token":"1//abcdEFGH"' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('1//abcdEFGH');
  });

  it('redacts "Bearer XYZ" tokens', () => {
    const out = scrub(makeEvent({ message: 'Authorization: Bearer abc.def.ghi' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('abc.def.ghi');
  });

  it('redacts +countrycode phone numbers', () => {
    const out = scrub(makeEvent({ message: 'WhatsApp to +972524809540 failed' }));
    expect(out?.message).toContain(REDACTED);
    expect(out?.message).not.toContain('+972524809540');
  });

  it('scrubs same patterns in event.exception.values[].value', () => {
    const out = scrub(makeEvent({
      exception: { values: [{ type: 'Error', value: 'meta returned access_token=oops' }] },
    }));
    expect(out?.exception?.values?.[0]?.value).toContain(REDACTED);
    expect(out?.exception?.values?.[0]?.value).not.toContain('oops');
  });

  it('scrubs same patterns in event.breadcrumbs[].message', () => {
    const out = scrub(makeEvent({
      breadcrumbs: [{ message: 'Bearer 0xCAFE', category: 'http' }],
    }));
    expect(out?.breadcrumbs?.[0]?.message).toContain(REDACTED);
    expect(out?.breadcrumbs?.[0]?.message).not.toContain('0xCAFE');
  });

  it('deletes event.request.data when URL matches /api/operator/', () => {
    const out = scrub(makeEvent({
      request: {
        url: 'https://x.vercel.app/api/operator/sync-now',
        data: { secretPayload: 'do-not-leak' },
      },
    }));
    expect(out?.request?.data).toBeUndefined();
  });

  it('preserves event.request.data for non-operator URLs', () => {
    const out = scrub(makeEvent({
      request: {
        url: 'https://x.vercel.app/api/data?from=2026-05-01&to=2026-05-30',
        data: { range: { from: '2026-05-01', to: '2026-05-30' } },
      },
    }));
    expect(out?.request?.data).toEqual({ range: { from: '2026-05-01', to: '2026-05-30' } });
  });
});

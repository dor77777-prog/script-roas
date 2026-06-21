import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inngest → Vercel Cron + QStash migration (Stage 3 Task 3.3): the "Send
// WhatsApp now" button no longer fires inngest.send('notifications/whatsapp
// .send-now'). The send is a single immediate action (no fan-out), so the route
// calls runWhatsappSlot(slot) inline — the SAME send path the old
// eventWhatsappSendNow function ran. We mock runWhatsappSlot so the test asserts
// ONLY the validation + inline-send wiring.
const mockRunWhatsappSlot = vi.hoisted(() => vi.fn());
vi.mock('@/inngest/functions/cronWhatsapp', () => ({
  runWhatsappSlot: (...args: unknown[]) => mockRunWhatsappSlot(...args),
}));

vi.mock('@/lib/sentry/capture', () => ({ captureRouteError: () => {} }));

import { POST } from '@/app/api/operator/notifications/send/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockRunWhatsappSlot.mockResolvedValue({ sent: 1, failed: 0 });
});

describe('POST /api/operator/notifications/send', () => {
  it('defaults to the noon slot and sends inline (202)', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({}) });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockRunWhatsappSlot).toHaveBeenCalledTimes(1);
    expect(mockRunWhatsappSlot).toHaveBeenCalledWith('noon');
    const body = await res.json();
    expect(body.trigger).toBe('noon');
  });

  it('sends the requested slot (eod)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ trigger: 'eod' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockRunWhatsappSlot).toHaveBeenCalledWith('eod');
  });

  it('sends the requested slot (evening)', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ trigger: 'evening' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
    expect(mockRunWhatsappSlot).toHaveBeenCalledWith('evening');
  });

  it('rejects an invalid trigger (400) and does NOT send', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ trigger: 'bad' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockRunWhatsappSlot).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// Smoke DOM test for WhatsappTestButtons (Horizon re-skin Wave 7 — operator
// panels adopt semantic Button variants).
//
// The 3-button row arms-to-confirm before dispatching a real WhatsApp message
// (P0-17 double-confirm guard). This test pins the re-skin-relevant contract:
//   1. All 3 trigger buttons render in the IDLE state, on the green "success"
//      Button variant (bg-status-greenBtn) — the variant that replaced the old
//      ghost+bg-status-greenBtn repaint.
//   2. A single click ARMS that button (idle → armed): aria-pressed flips true,
//      the label becomes "לחץ שוב לאישור …", and the surface switches to the
//      orange "warning" variant (bg-status-orangeBtn) — NOT a send (no fetch).
//   3. The explanatory copy (the +972524809540 destination / arm-window /
//      throttle note) is preserved verbatim.
//
// operatorFetch is mocked so an accidental send would surface as a call — the
// arming click must NOT trigger it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const operatorFetch = vi.fn(async (_input?: unknown, _init?: unknown) => ({
  status: 202,
  json: async () => ({ ok: true }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: (input: unknown, init?: unknown) => operatorFetch(input, init),
}));

import { WhatsappTestButtons } from '../WhatsappTestButtons';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WhatsappTestButtons — re-skin smoke (semantic Button variants)', () => {
  it('renders all three trigger buttons in the idle (success/green) state', () => {
    render(<WhatsappTestButtons />);
    const noon = screen.getByRole('button', { name: /שלח כמו 12:00/ });
    const evening = screen.getByRole('button', { name: /שלח כמו 18:00/ });
    const eod = screen.getByRole('button', { name: /שלח כמו 00:10/ });
    // Idle → green "success" variant; none armed.
    for (const btn of [noon, evening, eod]) {
      expect(btn.className).toContain('bg-status-greenBtn');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('arming flips idle → armed (warning/orange variant + confirm copy), without sending', () => {
    render(<WhatsappTestButtons />);
    const noon = screen.getByRole('button', { name: /שלח כמו 12:00/ });
    expect(noon.className).toContain('bg-status-greenBtn');

    // First click ARMS — does not send.
    fireEvent.click(noon);

    // The label morphs to the confirm prompt; query the now-armed button by it.
    const armed = screen.getByRole('button', { name: /לחץ שוב לאישור/ });
    expect(armed.getAttribute('aria-pressed')).toBe('true');
    expect(armed).toHaveAttribute('data-armed');
    // Armed → orange "warning" variant; no longer green.
    expect(armed.className).toContain('bg-status-orangeBtn');
    expect(armed.className).not.toContain('bg-status-greenBtn');
    // Still carries the armed-state contrast ring affordance.
    expect(armed.className).toContain('ring-status-warning');

    // The arming click is a UI-only guard — NO network send fired.
    expect(operatorFetch).not.toHaveBeenCalled();
  });

  it('arming one button leaves the other two idle (single-armed at a time)', () => {
    render(<WhatsappTestButtons />);
    fireEvent.click(screen.getByRole('button', { name: /שלח כמו 18:00/ }));

    // Evening armed…
    expect(
      screen.getByRole('button', { name: /לחץ שוב לאישור — שלח כמו 18:00/ }),
    ).toBeInTheDocument();
    // …the other two stay idle (green, not armed).
    const noon = screen.getByRole('button', { name: /^שלח כמו 12:00/ });
    const eod = screen.getByRole('button', { name: /^שלח כמו 00:10/ });
    for (const btn of [noon, eod]) {
      expect(btn.className).toContain('bg-status-greenBtn');
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('preserves the WhatsApp destination / arm-window / throttle copy', () => {
    render(<WhatsappTestButtons />);
    // 3-messages-a-day throttle schedule + the arm-to-confirm explanation.
    expect(screen.getByText(/12:00 \/ 18:00 \/ 00:10/)).toBeInTheDocument();
    expect(screen.getByText(/לחיצה ראשונה חוממת את/)).toBeInTheDocument();
  });
});

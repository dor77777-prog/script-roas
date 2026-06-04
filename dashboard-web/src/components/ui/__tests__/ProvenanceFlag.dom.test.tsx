// dashboard-web/src/components/ui/__tests__/ProvenanceFlag.dom.test.tsx
//
// Wave 3 · Data-Trust — DQ-4 · DOM contract for <ProvenanceFlag>.
//
// Pins (matches docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html,
// the Hero/P&L "אומדן חי" / "סופי" badges):
//   (a) verdict="live_estimate" → an info (blue) badge reading "אומדן חי",
//       with a HelpTooltip whose body explains the live-tick estimate
//   (b) verdict="finalized"     → a success (green) badge reading "סופי",
//       and NO tooltip surface (it's authoritative, nothing to caveat)
//   (c) verdict="unknown"       → renders nothing at all (return null) — a
//       historical row without a freshness flag must NOT show a false
//       "אומדן" tag
//
// Tone tokens are the paired on-color status tokens (never text-color-from-
// band), matching the Badge primitive's BADGE_TONE_BG map. We pin the DESKTOP
// (fine-pointer) branch via the useIsMobile mock so the HelpTooltip opens a
// deterministic role=tooltip surface on click.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Pin the desktop (fine-pointer) branch for the whole suite.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { ProvenanceFlag } from '../ProvenanceFlag';

describe('<ProvenanceFlag> (DQ-4)', () => {
  // (a) ----------------------------------------------------------------
  it('live_estimate renders an info badge reading "אומדן חי"', () => {
    render(<ProvenanceFlag verdict="live_estimate" />);
    const badge = screen.getByText('אומדן חי');
    expect(badge).toBeInTheDocument();
    // info → blue tone (paired on-color tokens, AA both themes).
    expect(badge.className).toMatch(/bg-status-blueBg/);
    expect(badge.className).toMatch(/text-status-blueFg/);
  });

  it('live_estimate exposes a HelpTooltip explaining the live tick', async () => {
    render(<ProvenanceFlag verdict="live_estimate" />);
    // Simple string content → Radix Tooltip (role=tooltip), which opens on
    // focus/hover (not click). Focus the trigger (the badge) to open it.
    fireEvent.focus(screen.getByText('אומדן חי'));
    const surface = await screen.findByRole('tooltip');
    expect(surface).toHaveTextContent(
      'מבוסס על tick חי כל ~10 דק׳; ננעל סופית בריקונסיילי הלילה',
    );
  });

  // (b) ----------------------------------------------------------------
  it('finalized renders a success badge reading "סופי" with no tooltip', () => {
    render(<ProvenanceFlag verdict="finalized" />);
    const badge = screen.getByText('סופי');
    expect(badge).toBeInTheDocument();
    // success → green tone.
    expect(badge.className).toMatch(/bg-status-greenBg/);
    expect(badge.className).toMatch(/text-status-greenFg/);
    // No tooltip surface — finalized is authoritative, nothing to caveat.
    fireEvent.click(badge);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // (c) ----------------------------------------------------------------
  it('unknown renders nothing (return null)', () => {
    const { container } = render(<ProvenanceFlag verdict="unknown" />);
    expect(container).toBeEmptyDOMElement();
    // The false "אומדן" / "סופי" tags must NOT leak onto a flag-less row.
    expect(screen.queryByText('אומדן חי')).toBeNull();
    expect(screen.queryByText('סופי')).toBeNull();
  });
});

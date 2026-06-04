// dashboard-web/src/components/ui/__tests__/OverrideFlag.dom.test.tsx
//
// Wave 3 · Data-Trust — DQ-3 · DOM contract for <OverrideFlag>.
//
// Pins (matches docs/superpowers/mockups/2026-06-04-data-trust/data-trust.html):
//   (a) always renders a Badge tone="warning" reading "● ידני"
//   (b) the HelpTooltip content includes the supplied note
//   (c) when lastEditedAt is supplied the tooltip content also carries
//       "· עודכן <lastEditedAt>"
//   (d) renders without crashing when note/lastEditedAt are omitted (the
//       PARENT decides whether to mount it; the flag itself always renders)
//
// We pin the DESKTOP (fine-pointer) branch via the useIsMobile mock so the
// HelpTooltip opens a deterministic role=dialog / role=tooltip surface.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Pin the desktop (fine-pointer) branch for the whole suite.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { OverrideFlag } from '../OverrideFlag';

describe('<OverrideFlag> (DQ-3)', () => {
  // (a) ----------------------------------------------------------------
  it('always renders a warning badge reading "● ידני"', () => {
    render(<OverrideFlag note="השבתת-חשבון 1-8/5" />);
    const badge = screen.getByText(/ידני/);
    expect(badge).toBeInTheDocument();
    // bullet marker present
    expect(badge.textContent).toMatch(/●/);
    // warning tone token classes (never text-color-from-band)
    expect(badge.className).toMatch(/bg-status-warningBg/);
    expect(badge.className).toMatch(/text-status-warningFg/);
  });

  // (b) ----------------------------------------------------------------
  it('tooltip content includes the note', async () => {
    render(<OverrideFlag note="השבתת-חשבון 1-8/5" />);
    // Click the trigger (the badge) to open the tap/click surface.
    fireEvent.click(screen.getByText(/ידני/));
    const surface = await screen.findByRole('dialog');
    expect(surface).toHaveTextContent('השבתת-חשבון 1-8/5');
  });

  // (c) ----------------------------------------------------------------
  it('tooltip content carries "· עודכן <lastEditedAt>" when supplied', async () => {
    render(
      <OverrideFlag note="השבתת-חשבון 1-8/5" lastEditedAt="12/5 14:30" />,
    );
    fireEvent.click(screen.getByText(/ידני/));
    const surface = await screen.findByRole('dialog');
    expect(surface).toHaveTextContent('השבתת-חשבון 1-8/5');
    expect(surface).toHaveTextContent('· עודכן 12/5 14:30');
  });

  // (d) ----------------------------------------------------------------
  it('renders without crashing when note/lastEditedAt are omitted', () => {
    expect(() => render(<OverrideFlag />)).not.toThrow();
    // badge still shows even with no note (parent gates mounting, not us)
    expect(screen.getByText(/ידני/)).toBeInTheDocument();
  });

  // (e) ----------------------------------------------------------------
  it('with only lastEditedAt, tooltip still surfaces the "· עודכן" suffix', async () => {
    render(<OverrideFlag lastEditedAt="12/5 14:30" />);
    fireEvent.click(screen.getByText(/ידני/));
    const surface = await screen.findByRole('dialog');
    expect(surface).toHaveTextContent('· עודכן 12/5 14:30');
  });
});

// dashboard-web/src/components/__tests__/refundIndicator.dom.test.tsx
//
// Tooltip-system-redesign — Phase 3b.
//
// RefundIndicator folded onto the HelpTooltip rich primitive. The bespoke
// portal/flip/isTouchDevice logic is gone; the breakdown now opens through
// HelpTooltip variant="rich" (desktop → Radix Popover role="dialog"). These
// tests pin the desktop branch and lock the preserved content: the
// "פירוט החזרים" heading + the "לפני החזרים" gross + the signed refund amount,
// numbers via <Money> (overflow-safe, no clip).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Pin desktop (fine-pointer) so the rich path is a Radix Popover (role=dialog).
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { RefundIndicator } from '../RefundIndicator';

describe('RefundIndicator — rich primitive (Phase 3b)', () => {
  it('renders nothing when there is no material refund', () => {
    const { container } = render(
      <RefundIndicator grossRevenue={1000} refundDeduction={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when refundDeduction is null', () => {
    const { container } = render(
      <RefundIndicator grossRevenue={1000} refundDeduction={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the refund trigger button when there is a material refund', () => {
    render(<RefundIndicator grossRevenue={1000} refundDeduction={120} />);
    expect(
      screen.getByRole('button', { name: 'הצג פירוט החזרים' }),
    ).toBeInTheDocument();
  });

  it('opens a role=dialog breakdown with the title + gross + signed refund (numbers via Money)', async () => {
    render(<RefundIndicator grossRevenue={1000} refundDeduction={120} />);
    fireEvent.click(screen.getByRole('button', { name: 'הצג פירוט החזרים' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('פירוט החזרים');
    expect(dialog).toHaveTextContent('לפני החזרים');
    expect(dialog).toHaveTextContent('סכום החזרים');
    // gross + signed refund rendered (Money → bare grouped, 2 decimals)
    expect(dialog).toHaveTextContent('1,000.00');
    expect(dialog).toHaveTextContent('120.00');
    // the breakdown is a dialog, never a role=tooltip (focusable-guard / ARIA)
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('falls back to "—" for an unknown gross revenue', async () => {
    render(<RefundIndicator grossRevenue={null} refundDeduction={120} />);
    fireEvent.click(screen.getByRole('button', { name: 'הצג פירוט החזרים' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('—');
    expect(dialog).toHaveTextContent('120.00');
  });
});

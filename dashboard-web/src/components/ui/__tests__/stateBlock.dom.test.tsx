// dashboard-web/src/components/ui/__tests__/stateBlock.dom.test.tsx
//
// Horizon re-skin Wave 1, debt #7 — <StateBlock> unifies the three
// async-surface states (skeleton / error / empty) that were previously
// hand-rolled and divergent across tabs (PaymentMethodsTab, CustomerValueTab,
// Dashboard, activity tabs …). This primitive is the single source of truth;
// the per-tab rollout is Wave 8.
//
// Patterns it matches (so the migration is a drop-in):
//   • skeleton  → the `.skeleton` token-shimmer placeholder + `aria-hidden`,
//                 wrapped in an `aria-busy` container (Dashboard.tsx:801,
//                 PaymentMethodsTab.tsx:481-486, CustomerValueTab.tsx:389).
//   • error     → `role="alert"` red strip (border-status-red / bg-status-redBg
//                 / text-status-redFg) + AlertTriangle + a retry <Button>
//                 (PaymentMethodsTab.tsx:451-479).
//   • empty     → centred icon + description + optional CTA <Button>
//                 (the settled-empty Card copy, upgraded to icon+CTA).
//
// Reduced-motion: the shimmer animation class is GATED through the existing
// useReducedMotion() hook (NOT only the CSS media sweep, which jsdom can't
// evaluate). The DOM runner's matchMedia stub reports reduce=true by default,
// so by default the shimmer is suppressed and the static gradient remains —
// these tests force both branches via a matchMedia stub.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StateBlock } from '@/components/ui/StateBlock';
import { Inbox } from 'lucide-react';

// Helper: stub window.matchMedia so we can drive the reduced-motion branch.
// `reduce=false` → animation allowed; `reduce=true` → animation suppressed.
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StateBlock — skeleton mode', () => {
  beforeEach(() => stubReducedMotion(false)); // allow animation by default here

  it('renders shimmer placeholders, count driven by the rows prop', () => {
    render(<StateBlock mode="skeleton" rows={5} />);

    const block = screen.getByTestId('state-skeleton');
    const placeholders = block.querySelectorAll('.skeleton');
    expect(placeholders.length).toBe(5);
  });

  it('defaults to a sensible row count when rows is omitted', () => {
    render(<StateBlock mode="skeleton" />);
    const placeholders = screen
      .getByTestId('state-skeleton')
      .querySelectorAll('.skeleton');
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it('sets aria-busy on the container and aria-hidden on every placeholder (no real text leaked)', () => {
    render(<StateBlock mode="skeleton" rows={3} message="loading payment data" />);

    const block = screen.getByTestId('state-skeleton');
    expect(block.getAttribute('aria-busy')).toBe('true');

    block.querySelectorAll('.skeleton').forEach((el) => {
      expect(el.getAttribute('aria-hidden')).toBe('true');
    });

    // The skeleton must NOT leak the (visually-hidden) loading message as
    // visible content — placeholders carry no text.
    block.querySelectorAll('.skeleton').forEach((el) => {
      expect(el.textContent).toBe('');
    });
  });

  it('applies the animating shimmer class when motion is allowed', () => {
    render(<StateBlock mode="skeleton" rows={2} />);
    const first = screen
      .getByTestId('state-skeleton')
      .querySelector('.skeleton') as HTMLElement;
    // motion-safe path: the explicit animate class is present.
    expect(first.className).toContain('motion-safe:animate-shimmer');
    // The block is not flagged as reduced.
    expect(
      screen.getByTestId('state-skeleton').getAttribute('data-reduced-motion'),
    ).toBe('false');
  });

  it('suppresses the JS-gated shimmer animation under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<StateBlock mode="skeleton" rows={2} />);
    const block = screen.getByTestId('state-skeleton');
    // Component-level gate: marks itself reduced, and the placeholders keep the
    // static `.skeleton` gradient but drop the JS-driven animate class.
    expect(block.getAttribute('data-reduced-motion')).toBe('true');
    const first = block.querySelector('.skeleton') as HTMLElement;
    expect(first.className).not.toContain('animate-shimmer');
  });
});

describe('StateBlock — error mode', () => {
  beforeEach(() => stubReducedMotion(true));

  it('renders role="alert" with the message', () => {
    render(<StateBlock mode="error" message="DB down" onRetry={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('DB down');
  });

  it('renders a retry button that fires onRetry', () => {
    const onRetry = vi.fn();
    render(<StateBlock mode="error" message="boom" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: /נסה שוב/ });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no onRetry is supplied', () => {
    render(<StateBlock mode="error" message="boom" />);
    expect(screen.queryByRole('button', { name: /נסה שוב/ })).toBeNull();
  });
});

describe('StateBlock — empty mode', () => {
  beforeEach(() => stubReducedMotion(true));

  it('renders the icon, description and a CTA wired to onAction', () => {
    const onAction = vi.fn();
    render(
      <StateBlock
        mode="empty"
        icon={<Inbox data-testid="empty-icon" />}
        description="אין עדיין נתונים לתצוגה"
        actionLabel="רענן"
        onAction={onAction}
      />,
    );

    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByText('אין עדיין נתונים לתצוגה')).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: 'רענן' });
    fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders the description without a CTA when onAction/actionLabel are absent', () => {
    render(<StateBlock mode="empty" description="אין נתונים" />);
    expect(screen.getByText('אין נתונים')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is not flagged as an alert or busy in empty mode', () => {
    render(<StateBlock mode="empty" description="אין נתונים" />);
    expect(screen.queryByRole('alert')).toBeNull();
    const block = screen.getByTestId('state-empty');
    expect(block.getAttribute('aria-busy')).not.toBe('true');
  });
});

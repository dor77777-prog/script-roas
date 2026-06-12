import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from '../Card';

describe('Card primitive', () => {
  it('renders all subcomponents', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardBody>Body</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  // Task 2.4 / Horizon reskin Wave-1 Task 1.1 — default Card applies the
  // canonical glass treatment with the Horizon chassis (rounded-hz 20px +
  // flex flex-col + bg-clip-border). The surface + theme-aware shadow come
  // from the `.glass` rule (background: --glass-1, box-shadow: --shadow-glass).
  it('default Card applies the `glass` class + Horizon chassis', () => {
    render(<Card data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).toMatch(/\bglass\b/);
    expect(cls).toMatch(/\brounded-hz\b/);
    expect(cls).toMatch(/\bflex\b/);
    expect(cls).toMatch(/\bflex-col\b/);
    expect(cls).toMatch(/\bbg-clip-border\b/);
    expect(cls).toMatch(/\bp-5\b/);
  });

  // Task 2.4 — legacy `variant="elevated"` aliases to default (no shadow
  // ladder difference any more; see Task 1.7). Still produces a glass card.
  it('accepts variant="elevated" → still renders as glass', () => {
    render(<Card variant="elevated" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/\bglass\b/);
  });

  // Task 2.4 — opt-out: `variant="flat"` strips the glass chrome via
  // !important overrides (so the inline rule wins over the .glass selector
  // even though both target the same element).
  it('accepts variant="flat" → strips background / border / shadow', () => {
    render(<Card variant="flat" data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).toMatch(/!bg-transparent/);
    expect(cls).toMatch(/!border-0/);
    expect(cls).toMatch(/!shadow-none/);
  });

  it('preserves user className via cn() merge (no clobber)', () => {
    render(<Card className="mt-10" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/mt-10/);
  });

  it('uses RTL-safe padding utilities (no pl-/pr-)', () => {
    render(<Card data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });

  // Task 2.4 — band prop forwards to `data-band` attribute. CSS in
  // globals.css (.glass[data-band="…"]) layers the band gradient + tint.
  // (Operator fix 2026-06-01 removed the top "roof" glow bar; the gradient
  // + white number + chip remain the band signal.)
  it('forwards `band` prop to data-band attribute', () => {
    render(<Card band="green" data-testid="card">x</Card>);
    expect(screen.getByTestId('card')).toHaveAttribute('data-band', 'green');
  });

  // Task 2.4 — freshness prop forwards to `data-freshness` attribute.
  // CSS in globals.css (.glass[data-freshness="…"]) handles the
  // desaturation stages (fresh / aging / stale).
  it('forwards `freshness` prop to data-freshness attribute', () => {
    render(<Card freshness="stale" data-testid="card">x</Card>);
    expect(screen.getByTestId('card')).toHaveAttribute('data-freshness', 'stale');
  });

  // Task 2.4 — omitting the band prop must NOT render a `data-band=""`
  // attribute (which would still match the [data-band] selector in CSS
  // and paint a transparent bar). React strips `undefined` props, so a
  // bare `<Card>` lands with no data-band attribute at all.
  it('omits data-band when band prop is not provided', () => {
    render(<Card data-testid="card">x</Card>);
    const el = screen.getByTestId('card');
    expect(el.hasAttribute('data-band')).toBe(false);
    expect(el.hasAttribute('data-freshness')).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Task 3.4 — onDrill API (Home cards drill into Campaigns tab).
  // ---------------------------------------------------------------------

  it('Task 3.4 — onDrill: click invokes the callback', () => {
    const onDrill = vi.fn();
    render(<Card onDrill={onDrill} data-testid="card">x</Card>);
    fireEvent.click(screen.getByTestId('card'));
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('Task 3.4 — onDrill: Enter invokes the callback', () => {
    const onDrill = vi.fn();
    render(<Card onDrill={onDrill} data-testid="card">x</Card>);
    fireEvent.keyDown(screen.getByTestId('card'), { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('Task 3.4 — onDrill: Space invokes the callback', () => {
    const onDrill = vi.fn();
    render(<Card onDrill={onDrill} data-testid="card">x</Card>);
    fireEvent.keyDown(screen.getByTestId('card'), { key: ' ' });
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('Task 3.4 — onDrill: applies role=button + tabIndex=0', () => {
    render(<Card onDrill={() => {}} data-testid="card">x</Card>);
    const el = screen.getByTestId('card');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('Task 3.4 — onDrill: caller-supplied role + tabIndex win over defaults', () => {
    render(
      <Card onDrill={() => {}} role="link" tabIndex={-1} data-testid="card">x</Card>,
    );
    const el = screen.getByTestId('card');
    expect(el.getAttribute('role')).toBe('link');
    expect(el.getAttribute('tabindex')).toBe('-1');
  });

  it('Task 3.4 — onDrill: applies cursor-pointer + focus-visible ring', () => {
    render(<Card onDrill={() => {}} data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).toMatch(/cursor-pointer/);
    expect(cls).toMatch(/focus-visible:ring-/);
  });

  it('Task 3.4 — no onDrill: card is NOT interactive (no role, no tabIndex, no cursor)', () => {
    render(<Card data-testid="card">x</Card>);
    const el = screen.getByTestId('card');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.className).not.toMatch(/cursor-pointer/);
  });

  it('Task 3.4 — onDrill: ignores non-Enter/Space keys', () => {
    const onDrill = vi.fn();
    render(<Card onDrill={onDrill} data-testid="card">x</Card>);
    const el = screen.getByTestId('card');
    fireEvent.keyDown(el, { key: 'a' });
    fireEvent.keyDown(el, { key: 'Tab' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onDrill).not.toHaveBeenCalled();
  });

  it('Task 3.4 — onDrill: caller onClick still fires (composed, not clobbered)', () => {
    const onDrill = vi.fn();
    const onClick = vi.fn();
    render(
      <Card onDrill={onDrill} onClick={onClick} data-testid="card">x</Card>,
    );
    fireEvent.click(screen.getByTestId('card'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledTimes(1);
  });

  it('Task 3.4 — onDrill: caller onClick calling preventDefault suppresses the drill', () => {
    const onDrill = vi.fn();
    const onClick = vi.fn((e: ReactMouseEvent) => e.preventDefault());
    render(
      <Card onDrill={onDrill} onClick={onClick} data-testid="card">x</Card>,
    );
    fireEvent.click(screen.getByTestId('card'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDrill).not.toHaveBeenCalled();
  });
});

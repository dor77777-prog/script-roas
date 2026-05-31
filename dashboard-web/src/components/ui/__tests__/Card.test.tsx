import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  // Task 2.4 — default Card applies the canonical glass treatment.
  it('default Card applies the `glass` class + plan-spec default chassis', () => {
    render(<Card data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).toMatch(/\bglass\b/);
    expect(cls).toMatch(/\brounded-card\b/);
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
  // globals.css (.glass[data-band="…"]) layers the top glow bar + tint.
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
});

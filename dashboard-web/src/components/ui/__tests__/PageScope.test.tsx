import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PageScope } from '../PageScope';

describe('PageScope primitive', () => {
  it('renders 4 [data-scope-item] children in RTL read order (store first)', () => {
    const { container } = render(
      <PageScope
        store="uzoshop"
        platform="Meta"
        rangeLabel="30 ימים"
        currency="CAD"
      />,
    );
    const items = container.querySelectorAll('[data-scope-item]');
    expect(items).toHaveLength(4);
    // RTL DOM read order — store first, then platform, range, currency
    expect(items[0]).toHaveTextContent('uzoshop');
    expect(items[1]).toHaveTextContent('Meta');
    expect(items[2]).toHaveTextContent('30 ימים');
    expect(items[3]).toHaveTextContent('CAD');
  });

  it('wraps store, platform, currency in <bdi dir="ltr"> (NOT rangeLabel)', () => {
    const { container } = render(
      <PageScope
        store="uzoshop"
        platform="Meta"
        rangeLabel="30 ימים"
        currency="CAD"
      />,
    );
    const items = container.querySelectorAll('[data-scope-item]');

    // store, platform, currency → wrapped in <bdi dir="ltr">
    const storeBdi = items[0].querySelector('bdi');
    const platformBdi = items[1].querySelector('bdi');
    const currencyBdi = items[3].querySelector('bdi');
    expect(storeBdi).not.toBeNull();
    expect(storeBdi?.getAttribute('dir')).toBe('ltr');
    expect(platformBdi).not.toBeNull();
    expect(platformBdi?.getAttribute('dir')).toBe('ltr');
    expect(currencyBdi).not.toBeNull();
    expect(currencyBdi?.getAttribute('dir')).toBe('ltr');

    // rangeLabel must NOT be wrapped in <bdi> (Hebrew text stays native RTL)
    expect(items[2].querySelector('bdi')).toBeNull();
  });

  it('renders 3 items when platform is omitted (store + range + currency)', () => {
    const { container } = render(
      <PageScope store="uzoshop" rangeLabel="30 ימים" currency="CAD" />,
    );
    const items = container.querySelectorAll('[data-scope-item]');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('uzoshop');
    expect(items[1]).toHaveTextContent('30 ימים');
    expect(items[2]).toHaveTextContent('CAD');
  });

  it('defaults currency to CAD when prop is omitted', () => {
    const { container } = render(
      <PageScope store="uzoshop" rangeLabel="30 ימים" />,
    );
    const items = container.querySelectorAll('[data-scope-item]');
    expect(items[items.length - 1]).toHaveTextContent('CAD');
  });

  it('renders `extra` ReactNode as the 5th item with a separator before it', () => {
    const { container } = render(
      <PageScope
        store="uzoshop"
        platform="Meta"
        rangeLabel="30 ימים"
        currency="CAD"
        extra={<span data-testid="extra-node">פעיל</span>}
      />,
    );
    const items = container.querySelectorAll('[data-scope-item]');
    // extra is a free ReactNode and is NOT required to carry [data-scope-item];
    // it sits after the 4 scope items with an aria-hidden bullet separator.
    expect(items).toHaveLength(4);
    expect(screen.getByTestId('extra-node')).toBeInTheDocument();

    // Bullets are aria-hidden spans. With platform + extra → 4 bullets total.
    const root = screen.getByRole('status', { name: 'scope' });
    const bullets = within(root).getAllByText('•');
    expect(bullets).toHaveLength(4);
    bullets.forEach((b) => expect(b.getAttribute('aria-hidden')).toBe('true'));
  });

  it('sets role="status" and aria-label="scope" on the root', () => {
    render(
      <PageScope
        store="uzoshop"
        platform="Meta"
        rangeLabel="30 ימים"
        currency="CAD"
      />,
    );
    const root = screen.getByRole('status', { name: 'scope' });
    expect(root).toBeInTheDocument();
  });

  it('bullets between items have aria-hidden', () => {
    render(
      <PageScope
        store="uzoshop"
        platform="Meta"
        rangeLabel="30 ימים"
        currency="CAD"
      />,
    );
    const root = screen.getByRole('status', { name: 'scope' });
    // store • platform • range • currency → 3 bullets when no extra
    const bullets = within(root).getAllByText('•');
    expect(bullets).toHaveLength(3);
    bullets.forEach((b) => expect(b.getAttribute('aria-hidden')).toBe('true'));
  });

  it('preserves user className via cn() merge', () => {
    render(
      <PageScope
        store="uzoshop"
        rangeLabel="30 ימים"
        currency="CAD"
        className="mt-10"
      />,
    );
    const root = screen.getByRole('status', { name: 'scope' });
    expect(root.className).toMatch(/mt-10/);
  });

  it('uses RTL-safe utilities (no pl-/pr-/ml-/mr-)', () => {
    render(<PageScope store="uzoshop" rangeLabel="30 ימים" currency="CAD" />);
    const root = screen.getByRole('status', { name: 'scope' });
    const cls = root.className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
    expect(cls).not.toMatch(/\bml-/);
    expect(cls).not.toMatch(/\bmr-/);
  });
});

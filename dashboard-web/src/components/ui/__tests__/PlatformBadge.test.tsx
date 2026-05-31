import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PlatformBadge,
  PLATFORM_LABEL,
  normalizePlatform,
  type Platform,
} from '../PlatformBadge';

describe('PlatformBadge primitive', () => {
  it('renders the canonical label for each platform', () => {
    const platforms: Platform[] = ['meta', 'google', 'tiktok', 'organic', 'shopify'];
    for (const p of platforms) {
      const { unmount } = render(
        <PlatformBadge platform={p} data-testid={`pb-${p}`} />,
      );
      expect(screen.getByTestId(`pb-${p}`)).toHaveTextContent(PLATFORM_LABEL[p]);
      unmount();
    }
  });

  it('consumes the --chart-platform-* tokens via text-chart-* utilities', () => {
    const cases: Array<[Platform, string]> = [
      ['meta',    'text-chart-meta'],
      ['google',  'text-chart-google'],
      ['tiktok',  'text-chart-tiktok'],
      ['organic', 'text-chart-organic'],
      ['shopify', 'text-chart-shopify'],
    ];
    for (const [platform, expectedClass] of cases) {
      const { unmount } = render(
        <PlatformBadge platform={platform} data-testid={`pb-${platform}`} />,
      );
      expect(screen.getByTestId(`pb-${platform}`).className).toMatch(
        new RegExp(expectedClass),
      );
      unmount();
    }
  });

  it('accepts any casing — Meta / meta / META all normalize to "meta"', () => {
    for (const raw of ['Meta', 'meta', 'META']) {
      const { unmount } = render(
        <PlatformBadge platform={raw as Platform} data-testid="pb" />,
      );
      const node = screen.getByTestId('pb');
      expect(node).toHaveTextContent('Meta');
      expect(node.className).toMatch(/text-chart-meta/);
      unmount();
    }
  });

  it('normalizes common aliases (facebook→meta, fb→meta, ga→google, tt→tiktok)', () => {
    expect(normalizePlatform('facebook')).toBe('meta');
    expect(normalizePlatform('FB')).toBe('meta');
    expect(normalizePlatform('GoogleAds')).toBe('google');
    expect(normalizePlatform('ga')).toBe('google');
    expect(normalizePlatform('tt')).toBe('tiktok');
  });

  it('returns null from normalizePlatform for unknown platforms', () => {
    expect(normalizePlatform('myspace')).toBeNull();
  });

  it('renders the colored dot by default and hides it when showDot=false', () => {
    const { container, rerender } = render(
      <PlatformBadge platform="meta" data-testid="pb" />,
    );
    // Dot is the 8x8 rounded-full span with bg-current.
    expect(container.querySelector('.bg-current')).not.toBeNull();
    rerender(<PlatformBadge platform="meta" showDot={false} data-testid="pb" />);
    expect(container.querySelector('.bg-current')).toBeNull();
  });

  it('renders the label by default and hides it when showLabel=false', () => {
    const { rerender } = render(
      <PlatformBadge platform="google" data-testid="pb" />,
    );
    expect(screen.getByTestId('pb')).toHaveTextContent('Google');
    rerender(
      <PlatformBadge platform="google" showLabel={false} data-testid="pb" />,
    );
    expect(screen.getByTestId('pb')).not.toHaveTextContent('Google');
  });

  it('honors a custom `label` prop (localization escape hatch)', () => {
    render(
      <PlatformBadge platform="meta" label="פייסבוק" data-testid="pb" />,
    );
    expect(screen.getByTestId('pb')).toHaveTextContent('פייסבוק');
  });

  it('renders a cart icon prefix for Shopify only (Q4 e-commerce category)', () => {
    const { container, rerender } = render(
      <PlatformBadge platform="shopify" data-testid="pb" />,
    );
    // ShoppingBag lucide icon renders as an svg.
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<PlatformBadge platform="meta" data-testid="pb" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('applies size variants — sm (h-5/text-xs) and md (h-6/text-sm)', () => {
    const { rerender } = render(
      <PlatformBadge platform="meta" size="sm" data-testid="pb" />,
    );
    expect(screen.getByTestId('pb').className).toMatch(/h-5/);
    expect(screen.getByTestId('pb').className).toMatch(/text-xs/);
    rerender(<PlatformBadge platform="meta" size="md" data-testid="pb" />);
    expect(screen.getByTestId('pb').className).toMatch(/h-6/);
    expect(screen.getByTestId('pb').className).toMatch(/text-sm/);
  });

  it('falls back gracefully on unknown platform — renders raw label + neutral color', () => {
    render(<PlatformBadge platform="myspace" data-testid="pb" />);
    const node = screen.getByTestId('pb');
    expect(node).toHaveTextContent('myspace');
    expect(node.className).toMatch(/text-ink-secondary/);
  });

  it('merges user className via cn()', () => {
    render(
      <PlatformBadge
        platform="meta"
        className="mt-2 opacity-80"
        data-testid="pb"
      />,
    );
    const cls = screen.getByTestId('pb').className;
    expect(cls).toMatch(/mt-2/);
    expect(cls).toMatch(/opacity-80/);
    expect(cls).toMatch(/text-chart-meta/);
  });
});

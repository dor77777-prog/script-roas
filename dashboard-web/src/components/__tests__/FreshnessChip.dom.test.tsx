// FIX #4 — FreshnessChip component test.
//
// Asserts the chip is driven by the AD-SPEND freshness folded with the
// data_daily write, NOT data_daily.updated_at alone: a stale ad-spend platform
// must force the chip OUT of the green/LIVE state even when dataLastWriteAt is
// recent (cron-live's Shopify-only revenue write bumps it every ~10 min).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FreshnessChip } from '../FreshnessChip';
import type { AdSpendFreshness } from '@/lib/types';

function ago(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function chipTone(container: HTMLElement): 'green' | 'yellow' | 'red' | 'gray' | 'unknown' {
  const el = container.querySelector('span[class*="bg-status-"], span[class*="bg-glass-2"]');
  const cls = el?.className ?? '';
  if (cls.includes('bg-status-greenBg')) return 'green';
  if (cls.includes('bg-status-orangeBg')) return 'yellow';
  if (cls.includes('bg-status-redBg')) return 'red';
  if (cls.includes('bg-glass-2')) return 'gray';
  return 'unknown';
}

describe('FreshnessChip — ad-spend fold (#4)', () => {
  it('fresh data_daily + fresh ad spend → green', () => {
    const adSpend: AdSpendFreshness = { meta: ago(3), google: ago(2), tiktok: ago(1) };
    const { container } = render(
      <FreshnessChip dataLastWriteAt={ago(2)} adSpendFreshness={adSpend} />,
    );
    expect(chipTone(container)).toBe('green');
  });

  it('fresh data_daily but 90-min-stale ad spend → NOT green (forced red)', () => {
    // cron-live just wrote revenue (2 min ago) but meta ad spend is 90 min
    // stale. Without the fold the chip would read green off data_daily; the
    // fold forces it red.
    const adSpend: AdSpendFreshness = { meta: ago(90), google: ago(2), tiktok: ago(1) };
    const { container } = render(
      <FreshnessChip dataLastWriteAt={ago(2)} adSpendFreshness={adSpend} />,
    );
    expect(chipTone(container)).not.toBe('green');
    expect(chipTone(container)).toBe('red');
  });

  it('fresh data_daily but 30-min-stale ad spend → yellow (not green)', () => {
    const adSpend: AdSpendFreshness = { meta: ago(30), google: ago(2), tiktok: ago(1) };
    const { container } = render(
      <FreshnessChip dataLastWriteAt={ago(2)} adSpendFreshness={adSpend} />,
    );
    expect(chipTone(container)).toBe('yellow');
  });

  it('no ad-spend map → degrades to the data_daily signal (green when fresh)', () => {
    const { container } = render(<FreshnessChip dataLastWriteAt={ago(2)} />);
    expect(chipTone(container)).toBe('green');
  });
});

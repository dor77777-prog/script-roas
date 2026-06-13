// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NcByPlatformCard } from '@/components/home/NcByPlatformCard';
import type { ChannelMetric } from '@/lib/home/channelTruth';

afterEach(cleanup);

// ncOrders 9 / 4 / 2 → total 15 → shares 60% / ~26.7% / ~13.3% (mirrors the
// mockup's 60 / 27 / 13 share bars). NC-ROAS bands: meta 2.9 ⇒ green,
// google 2.4 ⇒ orange, tiktok 1.8 ⇒ red.
const METRICS: ChannelMetric[] = [
  { channel: 'meta',   ncRevenue: 17400, ncOrders: 9, spend: 6000, ncRoas: 2.9, nCac: 58, ncNetProfit: 8000, overcountPct: null },
  { channel: 'google', ncRevenue: 7200,  ncOrders: 4, spend: 3000, ncRoas: 2.4, nCac: 71, ncNetProfit: 1500, overcountPct: null },
  { channel: 'tiktok', ncRevenue: 3600,  ncOrders: 2, spend: 2000, ncRoas: 1.8, nCac: 96, ncNetProfit: -200, overcountPct: null },
];

describe('NcByPlatformCard', () => {
  it('renders one inset per platform on the canonical bg-pill-track surface', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    for (const ch of ['meta', 'google', 'tiktok'] as const) {
      const inset = screen.getByTestId(`nc-platform-${ch}`);
      expect(inset).not.toBeNull();
      expect(inset.className).toContain('bg-pill-track');
    }
  });

  it('shows each platform new-customer count', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    expect(screen.getByTestId('nc-platform-meta').textContent).toContain('9');
    expect(screen.getByTestId('nc-platform-google').textContent).toContain('4');
    expect(screen.getByTestId('nc-platform-tiktok').textContent).toContain('2');
    // each inset labels the count "חדשים"
    expect(screen.getByTestId('nc-platform-meta').textContent).toContain('חדשים');
  });

  it('share-bar widths reflect ncOrders proportions (Σ ncOrders denominator)', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    // total = 15 → meta 60%, google 26.66…%, tiktok 13.33…%
    const meta = screen.getByTestId('nc-platform-share-meta') as HTMLElement;
    const google = screen.getByTestId('nc-platform-share-google') as HTMLElement;
    const tiktok = screen.getByTestId('nc-platform-share-tiktok') as HTMLElement;
    expect(meta.style.width).toBe('60%');
    expect(google.style.width).toBe(`${(4 / 15) * 100}%`);
    expect(tiktok.style.width).toBe(`${(2 / 15) * 100}%`);
  });

  it('renders nCAC through the overflow-safe <Money> primitive (bdi dir=ltr)', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    const meta = screen.getByTestId('nc-platform-meta');
    // Money renders a <bdi dir="ltr" class="metric-num"> — assert it exists and
    // carries the formatted nCAC ($58).
    const moneyEl = meta.querySelector('bdi.metric-num');
    expect(moneyEl).not.toBeNull();
    expect(meta.textContent).toContain('58');
  });

  it('NC-ROAS pill carries the correct band (green ≥2.7, orange 2.0–2.7, red <2.0)', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    expect(screen.getByTestId('nc-platform-roas-meta').className).toContain('chip-green');   // 2.9
    expect(screen.getByTestId('nc-platform-roas-google').className).toContain('chip-orange'); // 2.4
    expect(screen.getByTestId('nc-platform-roas-tiktok').className).toContain('chip-red');    // 1.8
    // the NC-ROAS value itself is shown
    expect(screen.getByTestId('nc-platform-roas-meta').textContent).toContain('2.90×');
  });

  it('the business NC-ROAS header chip uses the AA-safe band-chip recipe (not raw band text)', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    const chip = screen.getByTestId('nc-by-platform-business-chip');
    expect(chip.className).toContain('band-chip');
    // 1.74 < 2.0 → red band
    expect(chip.className).toContain('chip-red');
    expect(chip.textContent).toContain('1.74×');
    expect(chip.textContent).toContain('NC-ROAS עסקי');
  });

  it('OMITS the "חוזרים" (returning) line — no truthful per-platform returning data exists', () => {
    render(<NcByPlatformCard metrics={METRICS} businessNcRoas={1.74} />);
    // ChannelMetric exposes no returning-customer count per channel, so the card
    // must NOT render a "חוזרים" line anywhere (no fabricated/derived number).
    expect(screen.queryByTestId('nc-by-platform-card')!.textContent).not.toContain('חוזרים');
  });

  it('a channel with no spend / null NC-ROAS renders "—" and a gray band (no crash)', () => {
    const m: ChannelMetric[] = [
      { channel: 'meta', ncRevenue: 0, ncOrders: 0, spend: 0, ncRoas: null, nCac: null, ncNetProfit: null, overcountPct: null },
    ];
    render(<NcByPlatformCard metrics={m} businessNcRoas={null} />);
    const roas = screen.getByTestId('nc-platform-roas-meta');
    expect(roas.className).toContain('chip-gray');
    expect(roas.textContent).toContain('—');
    // nCAC null → em dash, not a fabricated 0
    expect(screen.getByTestId('nc-platform-meta').textContent).toContain('—');
    // business chip with null → em dash + gray
    const chip = screen.getByTestId('nc-by-platform-business-chip');
    expect(chip.textContent).toContain('—');
    expect(chip.className).toContain('chip-gray');
  });

  it('share is 0% when every platform has zero new customers (no divide-by-zero)', () => {
    const m: ChannelMetric[] = [
      { channel: 'meta',   ncRevenue: 0, ncOrders: 0, spend: 500, ncRoas: null, nCac: null, ncNetProfit: -500, overcountPct: null },
      { channel: 'google', ncRevenue: 0, ncOrders: 0, spend: 0,   ncRoas: null, nCac: null, ncNetProfit: null, overcountPct: null },
      { channel: 'tiktok', ncRevenue: 0, ncOrders: 0, spend: 0,   ncRoas: null, nCac: null, ncNetProfit: null, overcountPct: null },
    ];
    render(<NcByPlatformCard metrics={m} businessNcRoas={null} />);
    expect((screen.getByTestId('nc-platform-share-meta') as HTMLElement).style.width).toBe('0%');
  });
});

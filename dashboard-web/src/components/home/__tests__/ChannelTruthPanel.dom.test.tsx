// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChannelTruthPanel } from '@/components/home/ChannelTruthPanel';
import type { ChannelMetric } from '@/lib/home/channelTruth';

afterEach(cleanup);

const METRICS: ChannelMetric[] = [
  { channel: 'meta', ncRevenue: 24600, ncOrders: 158, spend: 6000, ncRoas: 4.1, nCac: 38 },
  { channel: 'google', ncRevenue: 9900, ncOrders: 67, spend: 3000, ncRoas: 3.3, nCac: 45 },
  { channel: 'tiktok', ncRevenue: 2400, ncOrders: 27, spend: 2000, ncRoas: 1.2, nCac: 74 },
];

describe('ChannelTruthPanel', () => {
  it('renders a card per channel with its NC-ROAS', () => {
    render(<ChannelTruthPanel metrics={METRICS} blendedNcRoas={3.3} blendedNcac={47} unclassifiableShare={0.31} />);
    expect(screen.getByTestId('channel-card-meta').textContent).toContain('4.1×');
    expect(screen.getByTestId('channel-card-google').textContent).toContain('3.3×');
    expect(screen.getByTestId('channel-card-tiktok').textContent).toContain('1.2×');
  });

  it('weak channel (<2×) is red, healthy (≥3×) is green', () => {
    render(<ChannelTruthPanel metrics={METRICS} />);
    expect(screen.getByTestId('channel-card-tiktok').querySelector('.text-status-redFg')).not.toBeNull();
    expect(screen.getByTestId('channel-card-meta').querySelector('.text-status-greenFg')).not.toBeNull();
  });

  it('shows the subsidy insight when channels straddle (best − worst ≥ 1)', () => {
    render(<ChannelTruthPanel metrics={METRICS} blendedNcRoas={3.3} />);
    const insight = screen.getByTestId('channel-insight');
    expect(insight.textContent).toContain('Meta');
    expect(insight.textContent).toContain('TikTok');
  });

  it('hides the insight when the spread is small', () => {
    const tight: ChannelMetric[] = METRICS.map((m, i) => ({ ...m, ncRoas: 3 + i * 0.1 }));
    render(<ChannelTruthPanel metrics={tight} />);
    expect(screen.queryByTestId('channel-insight')).toBeNull();
  });

  it('renders "—" for a channel with no NC-ROAS (no spend or no revenue)', () => {
    const m: ChannelMetric[] = [{ channel: 'meta', ncRevenue: 0, ncOrders: 0, spend: 0, ncRoas: null, nCac: null }];
    render(<ChannelTruthPanel metrics={m} />);
    expect(screen.getByTestId('channel-card-meta').textContent).toContain('—');
  });
});

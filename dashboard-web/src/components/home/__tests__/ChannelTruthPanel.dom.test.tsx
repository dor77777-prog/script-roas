// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChannelTruthPanel } from '@/components/home/ChannelTruthPanel';
import type { ChannelMetric } from '@/lib/home/channelTruth';

afterEach(cleanup);

const METRICS: ChannelMetric[] = [
  { channel: 'meta', ncRevenue: 24600, ncOrders: 158, spend: 6000, ncRoas: 4.1, nCac: 38, ncNetProfit: 11220, overcountPct: 0.38 },
  { channel: 'google', ncRevenue: 9900, ncOrders: 67, spend: 3000, ncRoas: 3.3, nCac: 45, ncNetProfit: 3930, overcountPct: 0 },
  { channel: 'tiktok', ncRevenue: 2400, ncOrders: 27, spend: 2000, ncRoas: 1.2, nCac: 74, ncNetProfit: -360, overcountPct: null },
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
    const m: ChannelMetric[] = [{ channel: 'meta', ncRevenue: 0, ncOrders: 0, spend: 0, ncRoas: null, nCac: null, ncNetProfit: null, overcountPct: null }];
    render(<ChannelTruthPanel metrics={m} />);
    expect(screen.getByTestId('channel-card-meta').textContent).toContain('—');
  });

  it('shows the overcount % row for a channel with overcountPct != null (and rounds it)', () => {
    render(<ChannelTruthPanel metrics={METRICS} />);
    const meta = screen.getByTestId('channel-card-meta');
    const row = meta.querySelector('[data-testid="channel-overcount-meta"]');
    expect(row).not.toBeNull();
    expect(meta.textContent).toContain('ספירת-יתר');
    expect(row!.textContent).toContain('+38%'); // 0.38 → +38%
    // google overcount 0 → renders +0%, row present (claim existed, no overcount)
    const google = screen.getByTestId('channel-card-google');
    expect(google.querySelector('[data-testid="channel-overcount-google"]')).not.toBeNull();
    expect(google.querySelector('[data-testid="channel-overcount-google"]')!.textContent).toContain('+0%');
  });

  it('hides the overcount row when overcountPct is null', () => {
    render(<ChannelTruthPanel metrics={METRICS} />);
    const tiktok = screen.getByTestId('channel-card-tiktok'); // overcountPct null
    expect(tiktok.querySelector('[data-testid="channel-overcount-tiktok"]')).toBeNull();
  });

  it('shows per-channel net profit (green positive, red negative)', () => {
    render(<ChannelTruthPanel metrics={METRICS} />);
    const meta = screen.getByTestId('channel-card-meta');
    const tiktok = screen.getByTestId('channel-card-tiktok');
    expect(meta.textContent).toContain('רווח-נטו');
    // meta net +11,220 → a greenFg element exists; tiktok net −360 → redFg exists
    expect(meta.querySelectorAll('.text-status-greenFg').length).toBeGreaterThan(0);
    expect(tiktok.querySelectorAll('.text-status-redFg').length).toBeGreaterThan(0);
  });
});

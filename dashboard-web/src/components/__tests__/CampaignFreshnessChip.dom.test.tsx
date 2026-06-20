// FIX F (#33) — CampaignFreshnessChip treated a FUTURE last_live_tick_at
// (clock skew between the worker host and the browser) as fresh-green BUT with
// a NEGATIVE-minute label ("-3 דק׳"). useStaleness clamps with Math.max(0, …);
// this chip must too. A future tick should clamp to 0 → "0 דק׳", fresh/green,
// never a negative number.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CampaignFreshnessChip } from '../CampaignFreshnessChip';

function future(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}
function past(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

describe('CampaignFreshnessChip — future timestamp clamps to 0 (FIX F #33)', () => {
  it('a future last_live_tick_at renders "0 דק׳", never a negative number', () => {
    const { container } = render(<CampaignFreshnessChip lastLiveTickAt={future(5)} />);
    const text = container.textContent ?? '';
    expect(text).toContain('0 דק׳');
    expect(text).not.toMatch(/-\d/); // no negative minute
  });

  it('a future tick is treated as fresh (green dot), not stale', () => {
    const { container } = render(<CampaignFreshnessChip lastLiveTickAt={future(5)} />);
    const dot = container.querySelector('span[class*="bg-status-"]');
    expect(dot?.className ?? '').toContain('bg-status-green');
  });

  it('zero regression: a 3-min-old tick still renders "3 דק׳" fresh', () => {
    const { container } = render(<CampaignFreshnessChip lastLiveTickAt={past(3)} />);
    expect(container.textContent ?? '').toContain('3 דק׳');
    const dot = container.querySelector('span[class*="bg-status-"]');
    expect(dot?.className ?? '').toContain('bg-status-green');
  });

  it('zero regression: null tick renders the em-dash placeholder', () => {
    const { container } = render(<CampaignFreshnessChip lastLiveTickAt={null} />);
    expect(container.textContent ?? '').toContain('—');
  });
});

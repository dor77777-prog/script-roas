// @vitest-environment jsdom
//
// Component tests for TikTokCoveragePanel (DQ-7).
//
// The panel self-fetches /api/operator/tiktok-coverage via SWR (fetchJsonOrNull)
// and computes coverage client-side (tiktokCoverage) against the campaign-store
// map in localStorage. We stub global fetch + isolate the SWR cache so each
// render starts cold, then assert on the post-fetch DOM via waitFor.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { TikTokCoveragePanel } from '../TikTokCoveragePanel';
import type { TikTokCoverageResp } from '../TikTokCoveragePanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function stubFetch(body: TikTokCoverageResp) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => body } as unknown as Response),
    ),
  );
}

function renderPanel() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TikTokCoveragePanel />
    </SWRConfig>,
  );
}

describe('TikTokCoveragePanel', () => {
  it('renders the static disclaimer, the unmapped count, and the unmapped campaign row', async () => {
    // 1 unmapped campaign (no explicit store-map entry → localStorage empty).
    stubFetch({
      accountTotalCad: 2002,
      campaigns: [{ campaignId: '17882041', advertiserId: 'acct_77', spendCad: 88 }],
    });

    renderPanel();

    // Static disclaimer stays ABOVE the live panel.
    expect(
      screen.getByText(/חשבון-פרסום/),
    ).toBeInTheDocument();

    // Live panel: the unmapped campaign row appears after the SWR fetch.
    await waitFor(() =>
      expect(screen.getByText('17882041')).toBeInTheDocument(),
    );
    expect(screen.getByText('acct_77')).toBeInTheDocument();

    // Unmapped count = 1, under its labelled stat cell.
    const countLabel = screen.getByText('קמפיינים לא-ממופים');
    const countCell = countLabel.closest('div');
    expect(countCell?.textContent).toContain('1');
  });

  it('surfaces the unmapped-campaign SPEND total, not just the count', async () => {
    // Two unmapped campaigns (empty store-map) carrying CAD 43 + 35 = 78. The
    // panel must show that 78 (the QA bug: it previously showed only the count
    // + "mapped 0 / unattributed 0", reading as "no spend issue").
    stubFetch({
      accountTotalCad: 78,
      campaigns: [
        { campaignId: '1866979241538642', advertiserId: 'adv_730', spendCad: 43 },
        { campaignId: '1867060827812098', advertiserId: 'adv_730', spendCad: 35 },
      ],
    });

    renderPanel();

    const spendLabel = await screen.findByText('הוצאה לא-ממופה');
    const spendCell = spendLabel.closest('div');
    expect(spendCell?.textContent).toContain('78');
  });
});

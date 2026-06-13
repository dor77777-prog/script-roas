// dashboard-web/src/components/insights/__tests__/ActionListPanel.dom.test.tsx
//
// WS3 — the always-visible "פעולות דחופות כרגע" action list that sits ABOVE
// the (collapsed) InsightsBoard. It is a thin presentational layer over the
// already-prioritized + already-visible insight list: it renders the rows via
// the shared InsightCardRow primitive, surfaces a count, a calm empty state,
// and a loading state, and wires each row's "טיפלתי" / "הסתר" to onMark.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { ActionListPanel } from '../ActionListPanel';
import type { Insight } from '@/lib/insights';

afterEach(cleanup);

const CRIT: Insight = {
  id: 'died-c1',
  severity: 'critical',
  kind: 'anomaly',
  title: 'קמפיין A כבה — מ-CAD 142/יום ל-0',
  detail: 'הוציא בממוצע CAD 142 ליום ב-9 ימים, והיום CAD 0.',
  why: 'קמפיין מבוסס שירד פתאום ל-0 — סימן אדום לרווח אבוד.',
  weight: 96,
  scope: 'Meta · uzoshop',
  campaignId: 'c1',
  campaignName: 'קמפיין A',
  platform: 'Meta',
  storeId: 'store-uzo',
  storeName: 'uzoshop',
};

const OPP: Insight = {
  id: 'fatigue-a1',
  severity: 'opportunity',
  kind: 'recommendation',
  title: 'עייפות קריאייטיב: Ad X',
  detail: 'CTR ירד 38% ו-CPM עלה 24% בחצי האחרון. שקול לרענן קריאייטיב.',
  why: 'CTR 2.10%→1.30%.',
  weight: 68,
  scope: 'TikTok · uzoshop',
  campaignId: 'c2',
  campaignName: 'קמפיין B',
  platform: 'TikTok',
  storeId: 'store-uzo',
  storeName: 'uzoshop',
};

describe('ActionListPanel', () => {
  it('renders the title and a count of the actions shown', () => {
    render(<ActionListPanel insights={[CRIT, OPP]} onMark={() => {}} adAccounts={{}} />);
    const panel = screen.getByTestId('action-list-panel');
    expect(panel.textContent).toContain('פעולות דחופות כרגע');
    expect(screen.getByTestId('action-list-count').textContent).toBe('2');
  });

  it('renders a row per insight with its title', () => {
    render(<ActionListPanel insights={[CRIT, OPP]} onMark={() => {}} adAccounts={{}} />);
    expect(screen.getByText(/קמפיין A כבה/)).toBeInTheDocument();
    expect(screen.getByText(/עייפות קריאייטיב: Ad X/)).toBeInTheDocument();
  });

  it('shows the calm empty state when there are no actions and not loading', () => {
    render(<ActionListPanel insights={[]} onMark={() => {}} adAccounts={{}} />);
    expect(screen.getByTestId('action-list-panel').textContent).toContain('אין פעולות דחופות כרגע');
    expect(screen.getByTestId('action-list-count').textContent).toBe('0');
  });

  it('shows a loading hint (not the all-good state) while analyzing with no results yet', () => {
    render(<ActionListPanel insights={[]} loading onMark={() => {}} adAccounts={{}} />);
    const panel = screen.getByTestId('action-list-panel');
    expect(panel.textContent).toContain('מנתח');
    expect(panel.textContent).not.toContain('אין פעולות דחופות כרגע');
  });

  it('calls onMark(insight, "done") when the row\'s "טיפלתי" is clicked', () => {
    const onMark = vi.fn();
    render(<ActionListPanel insights={[CRIT, OPP]} onMark={onMark} adAccounts={{}} />);
    const doneButtons = screen.getAllByRole('button', { name: /טיפלתי/ });
    fireEvent.click(doneButtons[0]);
    expect(onMark).toHaveBeenCalledTimes(1);
    expect(onMark).toHaveBeenCalledWith(CRIT, 'done');
  });

  it('calls onMark(insight, "ignored") when the row\'s "הסתר" is clicked', () => {
    const onMark = vi.fn();
    render(<ActionListPanel insights={[OPP]} onMark={onMark} adAccounts={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /הסתר/ }));
    expect(onMark).toHaveBeenCalledWith(OPP, 'ignored');
  });

  it('renders critical rows with the critical foreground token', () => {
    render(<ActionListPanel insights={[CRIT]} onMark={() => {}} adAccounts={{}} />);
    const panel = screen.getByTestId('action-list-panel');
    expect(within(panel).getByText(/קמפיין A כבה/)).toBeInTheDocument();
    expect(panel.querySelector('.text-status-redFg')).not.toBeNull();
  });

  // ── Horizon re-skin (W3.7) ──────────────────────────────────────────────
  it('header uses the neutral Horizon icon-circle token, NOT an accent-gradient band', () => {
    const { container } = render(
      <ActionListPanel insights={[CRIT]} onMark={() => {}} adAccounts={{}} />,
    );
    // The accent-gradient header band was removed in the re-skin.
    expect(container.querySelector('[class*="bg-gradient-to-l"]')).toBeNull();
    // The lead icon now sits in the canonical Horizon icon-circle on the
    // mode-aware recessed-well token (bg-pill-track = lightPrimary light /
    // navy-700 dark), the same recipe the home cards use — token-only, no
    // dark: variant.
    expect(container.querySelector('.bg-pill-track.rounded-full')).not.toBeNull();
  });

  it('renders icon glyphs only (lucide SVGs) — no emoji characters as UI icons', () => {
    const { container } = render(
      <ActionListPanel insights={[CRIT, OPP]} onMark={() => {}} adAccounts={{}} />,
    );
    // Every severity / action icon is a lucide <svg>; the rendered text must
    // carry no emoji codepoint (Horizon rule: lucide, never emoji).
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    expect(emoji.test(container.textContent ?? '')).toBe(false);
  });
});

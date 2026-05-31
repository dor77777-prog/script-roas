// dashboard-web/src/components/__tests__/campaignsTopListArrow.dom.test.tsx
//
// Wave 4 / Task 4.1 — RTL arrow regression for CampaignsTopList verdicts.
//
// Previously the verdict text was prefixed with a Unicode "→" (U+2192).
// Under Hebrew RTL the right-pointing glyph rendered pointing AWAY from the
// verdict it referred to, so the chip felt visually disconnected. We replaced
// it with the lucide `ArrowLeft` icon (renders as SVG, no bidi reordering;
// under RTL flow the leftwards visual matches the reading direction toward
// the verdict text).
//
// These tests pin the icon component + assert that the legacy U+2192 is
// gone so a future refactor can't silently regress the bidi direction.
//
// Per CONTRIBUTING.md / past hot-fixes: tests live next to their components
// and assert real DOM, not snapshot mocks.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignsTopList, type CampaignTopListPoint } from '../CampaignsTopList';

const DATA: CampaignTopListPoint[] = [
  // 2 winners (high ROAS) + 2 losers (low ROAS) → 4-row split.
  { name: 'Winner Hi',  platform: 'Meta',   storeName: 'uzoshop',  roas: 5.0, cac: 12, spend: 1200 },
  { name: 'Winner Mid', platform: 'Google', storeName: 'usmile360', roas: 3.0, cac: 25, spend: 900 },
  { name: 'Loser Mid',  platform: 'Meta',   storeName: 'uzoshop',  roas: 1.5, cac: 80, spend: 400 },
  { name: 'Loser Bad',  platform: 'TikTok', storeName: 'uzoshop',  roas: 0.4, cac: 200, spend: 600 },
];

describe('Wave 4 / Task 4.1 — CampaignsTopList verdict arrow is RTL-safe', () => {
  it('renders a logical ArrowLeft icon (lucide SVG) inside every verdict, not a Unicode →', () => {
    const { container } = render(<CampaignsTopList data={DATA} title="Test" />);

    // Every verdict chip carries the test-id we added in the component.
    const verdicts = container.querySelectorAll<HTMLElement>('[data-testid="campaigns-top-list-verdict"]');
    expect(verdicts.length).toBeGreaterThan(0);

    for (const v of verdicts) {
      // 1. NO Unicode rightwards arrow in any verdict — the legacy bug.
      expect(v.textContent ?? '').not.toContain('→'); // →
      // 2. Each verdict carries the dedicated <svg> arrow icon.
      const arrow = v.querySelector('[data-testid="campaigns-top-list-verdict-arrow"]');
      expect(arrow).not.toBeNull();
      expect(arrow!.tagName.toLowerCase()).toBe('svg');
      // 3. aria-hidden so screen readers don't announce a stray arrow.
      expect(arrow!.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('renders the verdict text for both winner and loser variants', () => {
    render(<CampaignsTopList data={DATA} title="Test" />);
    // Winner verdict (roas >= 4 → "הגדל תקציב משמעותית").
    expect(screen.getByText(/הגדל תקציב משמעותית/)).toBeInTheDocument();
    // Loser verdict (roas < 1 → "סגור או בדוק מיפוי").
    expect(screen.getByText(/סגור או בדוק מיפוי/)).toBeInTheDocument();
  });
});

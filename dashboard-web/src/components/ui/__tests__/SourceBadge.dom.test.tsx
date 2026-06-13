// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SourceBadge } from '@/components/ui/SourceBadge';
afterEach(() => cleanup());

describe('SourceBadge — precise per-event attribution (classify-v2 T3)', () => {
  /* ---- Platform sources: paid vs organic are DISTINCT (textual qualifier) -- */

  it('meta-paid → "ממומן · מטא" (paid qualifier + Meta)', () => {
    render(<SourceBadge source="meta-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ממומן');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('מטא');
  });

  it('meta-organic → "אורגני · מטא" (organic qualifier + Meta) — DISTINCT from meta-paid', () => {
    render(<SourceBadge source="meta-organic" />);
    const badge = screen.getByTestId('source-badge');
    expect(badge).toHaveTextContent('אורגני');
    expect(badge).toHaveTextContent('מטא');
    // The organic qualifier must NOT collapse into the paid one.
    expect(badge).not.toHaveTextContent('ממומן');
  });

  it('meta-paid and meta-organic render DIFFERENT text (no collapse)', () => {
    const { container: paid } = render(<SourceBadge source="meta-paid" />);
    cleanup();
    const { container: organic } = render(<SourceBadge source="meta-organic" />);
    expect(paid.textContent).not.toBe(organic.textContent);
  });

  it('google-paid → ממומן + גוגל; google-organic → אורגני + גוגל', () => {
    render(<SourceBadge source="google-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ממומן');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('גוגל');
    cleanup();
    render(<SourceBadge source="google-organic" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('אורגני');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('גוגל');
  });

  it('tiktok-paid → ממומן + טיקטוק; tiktok-organic → אורגני + טיקטוק', () => {
    render(<SourceBadge source="tiktok-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ממומן');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('טיקטוק');
    cleanup();
    render(<SourceBadge source="tiktok-organic" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('אורגני');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('טיקטוק');
  });

  /* ---- Non-platform sources: each DISTINCT (not all "ישיר") --------------- */

  it('email → "אימייל" (its own distinct chip)', () => {
    render(<SourceBadge source="email" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('אימייל');
  });

  it('other-paid → "ממומן · אחר" (paid, distinct)', () => {
    render(<SourceBadge source="other-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ממומן');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('אחר');
  });

  it('other-referral → "הפניה" (distinct from direct)', () => {
    render(<SourceBadge source="other-referral" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('הפניה');
  });

  it('search-organic → "חיפוש אורגני"', () => {
    render(<SourceBadge source="search-organic" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('חיפוש אורגני');
  });

  it('app-referral → "הפניה מאפליקציה"', () => {
    render(<SourceBadge source="app-referral" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('הפניה מאפליקציה');
  });

  it('direct → "ישיר" (muted)', () => {
    render(<SourceBadge source="direct" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ישיר');
  });

  it('email / other-referral / search-organic / app-referral / direct are all DISTINCT (not collapsed to one chip)', () => {
    const texts = ['email', 'other-referral', 'search-organic', 'app-referral', 'direct'].map(
      (s) => {
        cleanup();
        render(<SourceBadge source={s} />);
        return screen.getByTestId('source-badge').textContent;
      },
    );
    expect(new Set(texts).size).toBe(texts.length);
  });

  /* ---- null / '' → renders nothing ---------------------------------------- */

  it('null source renders nothing', () => {
    const { container } = render(<SourceBadge source={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('empty-string source renders nothing', () => {
    const { container } = render(<SourceBadge source="" />);
    expect(container.firstChild).toBeNull();
  });

  /* ---- First-click lens: ONLY on weak last-touch + present platform first-touch */

  it('weak source (direct) + meta-paid first-touch → shows "קליק ראשון: מטא" lens', () => {
    render(<SourceBadge source="direct" firstTouchSource="meta-paid" />);
    expect(screen.getByTestId('source-badge')).toHaveTextContent('ישיר');
    const lens = screen.getByTestId('first-click-lens');
    expect(lens).toHaveTextContent('קליק ראשון');
    expect(lens).toHaveTextContent('מטא');
  });

  it('weak source (other-referral) + google-paid first-touch → shows גוגל lens', () => {
    render(<SourceBadge source="other-referral" firstTouchSource="google-paid" />);
    expect(screen.getByTestId('first-click-lens')).toHaveTextContent('גוגל');
  });

  it('weak source (other-paid) + tiktok-paid first-touch → shows טיקטוק lens', () => {
    render(<SourceBadge source="other-paid" firstTouchSource="tiktok-paid" />);
    expect(screen.getByTestId('first-click-lens')).toHaveTextContent('טיקטוק');
  });

  it('CONFIDENT source (meta-paid) + first-touch set → NO lens (redundant)', () => {
    render(<SourceBadge source="meta-paid" firstTouchSource="google-paid" />);
    expect(screen.queryByTestId('first-click-lens')).toBeNull();
  });

  it('weak source (direct) + NO first-touch → NO lens', () => {
    render(<SourceBadge source="direct" firstTouchSource={null} />);
    expect(screen.queryByTestId('first-click-lens')).toBeNull();
  });

  it('weak source (direct) + first-touch with NO platform (other-referral) → NO lens', () => {
    render(<SourceBadge source="direct" firstTouchSource="other-referral" />);
    expect(screen.queryByTestId('first-click-lens')).toBeNull();
  });

  it('first-touch given but source omitted → renders nothing (null source still wins)', () => {
    const { container } = render(<SourceBadge source={null} firstTouchSource="meta-paid" />);
    expect(container.firstChild).toBeNull();
  });

  /* ---- Horizon re-skin (W3.6): AA-safe neutral-scrim chip, no vivid hue fill -- */

  it('paid chip sits on the NEUTRAL pill-track well (token), never a platform-hue fill — text clears AA', () => {
    render(<SourceBadge source="meta-paid" />);
    const badge = screen.getByTestId('source-badge');
    // The chip surface is the canonical inset token (pill-track), a neutral
    // scrim — the brand-mirrored platform name/dot carry the hue, not the bg.
    expect(badge.className).toContain('bg-pill-track');
    // It must NOT tint the chip background with a platform/brand hue (which
    // would break the AA guarantee for the text-on-tint).
    expect(badge.className).not.toMatch(/bg-(chart|roas|status|brand)/);
  });

  it('non-platform (direct) chip uses the neutral pill-track well token', () => {
    render(<SourceBadge source="direct" />);
    const badge = screen.getByTestId('source-badge');
    expect(badge.className).toContain('bg-pill-track');
    expect(badge.className).not.toMatch(/bg-(chart|roas|status|brand)/);
  });

  it('uses lucide/text icons only — no emoji glyph anywhere in the badge', () => {
    // Render a representative mix; assert no emoji-range codepoint leaks into UI.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    for (const src of ['meta-paid', 'google-organic', 'email', 'direct']) {
      cleanup();
      const { container } = render(<SourceBadge source={src} />);
      expect(container.textContent ?? '').not.toMatch(EMOJI);
    }
  });
});

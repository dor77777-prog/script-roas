import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CohortAsOfBadge } from '@/components/customers/CohortAsOfBadge';

// DQ-6 — CohortAsOfBadge. "עודכן ל-" freshness flag for the cohort/LTV
// refresh on the customers (לקוחות) tab.
//   • asOf null            → render nothing
//   • age ≤ 7d (fresh)     → Badge tone="info"(blue), "עודכן: DD/MM"
//   • age > 7d (stale)     → Badge tone="warning", "עודכן: DD/MM ⚠" + HelpTooltip
// `now` is an injected ISO seam so the age math is deterministic in tests.
describe('CohortAsOfBadge (DQ-6)', () => {
  // Fixed "now" so the relative-age branch never depends on the wall clock.
  const NOW = '2026-06-04T08:00:00Z';

  it('renders nothing when asOf is null', () => {
    const { container } = render(<CohortAsOfBadge asOf={null} now={NOW} />);
    expect(container.firstChild).toBeNull();
  });

  it('fresh (now-aligned, ≤7d): info tone, "עודכן: DD/MM", no warning glyph', () => {
    // 03/06 — one day before NOW → fresh.
    render(<CohortAsOfBadge asOf="2026-06-03T04:00:00Z" now={NOW} />);
    const badge = screen.getByTestId('cohort-as-of-badge');
    expect(badge.textContent).toContain('עודכן:');
    expect(badge.textContent).toContain('03/06');
    expect(badge.textContent).not.toContain('⚠');
    expect(badge.getAttribute('data-tone')).toBe('info');
  });

  it('stale (10 days earlier, >7d): warning tone, "⚠", and a HelpTooltip', async () => {
    // 25/05 — 10 days before NOW → stale.
    render(<CohortAsOfBadge asOf="2026-05-25T04:00:00Z" now={NOW} />);
    const badge = screen.getByTestId('cohort-as-of-badge');
    expect(badge.textContent).toContain('עודכן:');
    expect(badge.textContent).toContain('25/05');
    expect(badge.textContent).toContain('⚠');
    expect(badge.getAttribute('data-tone')).toBe('warning');

    // The stale caveat is wired through the Radix <HelpTooltip> (the repo's
    // no-native-title rule forbids title=); content mounts on hover.
    fireEvent.pointerMove(badge);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('נתוני קוהורט מתעדכנים שבועית');
  });

  it('exactly 7 days old is still treated as fresh (info, no warning)', () => {
    // 28/05 — exactly 7 days before NOW (boundary): ≤7d → fresh.
    render(<CohortAsOfBadge asOf="2026-05-28T08:00:00Z" now={NOW} />);
    const badge = screen.getByTestId('cohort-as-of-badge');
    expect(badge.getAttribute('data-tone')).toBe('info');
    expect(badge.textContent).not.toContain('⚠');
  });

  it('formats the date as DD/MM in Israel TZ', () => {
    // 2026-06-03T22:30:00Z is 2026-06-04 01:30 IDT (UTC+3) → 04/06, not 03/06.
    render(<CohortAsOfBadge asOf="2026-06-03T22:30:00Z" now="2026-06-05T08:00:00Z" />);
    const badge = screen.getByTestId('cohort-as-of-badge');
    expect(badge.textContent).toContain('04/06');
  });
});

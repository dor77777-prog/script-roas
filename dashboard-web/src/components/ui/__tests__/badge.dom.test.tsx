import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, BADGE_TONE_BG } from '@/components/ui/Badge';

describe('Badge — BADGE_TONE_BG export', () => {
  it('exports a map with red/orange/green/blue/gray/warning tones', () => {
    expect(Object.keys(BADGE_TONE_BG).sort()).toEqual(
      ['blue', 'gray', 'green', 'orange', 'red', 'warning'].sort(),
    );
  });

  it('every tone uses the camelCase Tailwind class form (no kebab -bg/-fg)', () => {
    for (const [, classes] of Object.entries(BADGE_TONE_BG)) {
      // Should match `bg-status-XBg text-status-XFg` (camelCase suffix)
      expect(classes).toMatch(/bg-status-[a-z]+Bg/);
      expect(classes).toMatch(/text-status-[a-z]+Fg/);
      expect(classes).not.toMatch(/-bg\b/);
      expect(classes).not.toMatch(/-fg\b/);
    }
  });

  it('Badge rendered with tone="warning" applies BADGE_TONE_BG.warning classes', () => {
    render(<Badge tone="warning">warn</Badge>);
    const el = screen.getByText('warn');
    for (const cls of BADGE_TONE_BG.warning.split(' ')) {
      expect(el.className).toContain(cls);
    }
  });
});

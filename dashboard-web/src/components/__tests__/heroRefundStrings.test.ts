import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Source-string lock for the refund-visibility UX strings in HeroOverview.
// The project does not run @testing-library/react render tests broadly, so
// these grep-style locks catch accidental string drift.
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../HeroOverview.tsx'),
  'utf8',
);

describe('HeroOverview — refund-visibility strings', () => {
  it('imports the refund heuristic helpers', () => {
    expect(SRC).toMatch(/from\s+['"]@\/lib\/refundDayHeuristic['"]/);
    expect(SRC).toMatch(/isHeavyRefundDay|heavyRefundDates|sumRefundsInRange/);
  });
  it('renders the chip text "יום רפאנד כבד" when there is exactly one heavy day', () => {
    expect(SRC).toMatch(/יום רפאנד כבד/);
  });
  it('renders the multi-day chip pattern "ימי רפאנד כבדים"', () => {
    expect(SRC).toMatch(/ימי רפאנד כבדים/);
  });
  it('appends a refund clause to the story when sumRefundsInRange > 0', () => {
    expect(SRC).toMatch(/(החזרים מעובדים|עובדו .* בהחזרים)/);
  });
  it('uses the status-warning palette (tokens route through --status-warning)', () => {
    expect(SRC).toMatch(/status-warning/);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../PnLBreakdown.tsx'),
  'utf8',
);

describe('PnLBreakdown — refund-visibility strings', () => {
  it('imports sumRefundsInRange from the heuristic module', () => {
    expect(SRC).toMatch(/from\s+['"]@\/lib\/refundDayHeuristic['"]/);
    expect(SRC).toMatch(/sumRefundsInRange/);
  });
  it('renders the new label "החזרים בתקופה"', () => {
    expect(SRC).toMatch(/החזרים בתקופה/);
  });
  it('renders the explanatory note that this is presentational only', () => {
    expect(SRC).toMatch(/כבר מנוכים מההכנסות/);
  });
  it('marks the revenue row label with (נטו)', () => {
    expect(SRC).toMatch(/הכנסות.*\(נטו\)/);
  });
  it('removes the stale current_total_price reference from the revenue note', () => {
    expect(SRC).not.toMatch(/current_total_price/);
  });
});

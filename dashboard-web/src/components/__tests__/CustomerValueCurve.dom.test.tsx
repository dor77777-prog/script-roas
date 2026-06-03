// Tooltip-system-redesign — Phase 4 · Task 4.2.
//
// Render smoke + retrofit guards for <CustomerValueCurve>. jsdom does not
// measure SVG geometry (getBoundingClientRect → 0), so the hover tooltip can't
// be triggered via simulated pointer events here; the chrome retrofit + ARIA
// are verified visually and by the source. This suite pins the render contract
// (curve + payback callout render) so the retrofit doesn't regress structure.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomerValueCurve } from '@/components/CustomerValueCurve';

describe('<CustomerValueCurve>', () => {
  it('renders the curve SVG and the payback callout for a profitable cohort', () => {
    render(
      <CustomerValueCurve
        points={[0, 18, 36, 52, 70, 88, 104, 120, 134, 148, 160, 172]}
        ncac={60}
        paybackMonths={3}
        basisLabel="רווח"
      />,
    );
    // The chart wrap + SVG render.
    expect(screen.getByTestId('cv-curve')).toBeInTheDocument();
    expect(screen.getByLabelText('עקומת שווי לקוח לאורך זמן')).toBeInTheDocument();
    // Payback callout is drawn (ncac crossed at month 3).
    expect(screen.getByTestId('cv-payback-callout')).toBeInTheDocument();
  });

  it('renders without a break-even line when ncac is null (no callout)', () => {
    render(
      <CustomerValueCurve
        points={[0, 10, 20, 30]}
        ncac={null}
        paybackMonths={null}
        basisLabel="הכנסה"
      />,
    );
    expect(screen.getByTestId('cv-curve')).toBeInTheDocument();
    expect(screen.queryByTestId('cv-payback-callout')).not.toBeInTheDocument();
  });

  it('does not show the hover tooltip on initial render', () => {
    render(
      <CustomerValueCurve
        points={[0, 18, 36, 52]}
        ncac={60}
        paybackMonths={null}
        basisLabel="רווח"
      />,
    );
    expect(screen.queryByTestId('cv-curve-tooltip')).not.toBeInTheDocument();
  });
});

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

  it('renders the nCAC break-even line INSIDE the y-domain when nCAC exceeds the curve max (losing case)', () => {
    // 2026-06-10 audit (live-pass #2): with nCAC above the curve's peak the
    // reference line must still render — the y-domain includes ncac
    // (maxY = max(curve, ncac) × 1.12), so the dashed line + its label sit
    // visibly ABOVE the curve. No payback callout exists (no crossing).
    const points = [0, 8, 15, 21, 26, 30, 34, 37, 40, 43, 46, 49]; // max 49
    const { container } = render(
      <CustomerValueCurve points={points} ncac={52} paybackMonths={null} basisLabel="רווח" />,
    );
    // The label renders…
    const label = screen.getByText(/קו עלות-גיוס/);
    expect(label).toBeInTheDocument();
    // …and its y position is INSIDE the plot (between pad.t=22 and the
    // baseline VIEW_H - pad.b = 284), i.e. not clipped above the domain.
    const labelY = Number(label.getAttribute('y'));
    expect(labelY).toBeGreaterThan(22);
    expect(labelY).toBeLessThan(284);
    // The dashed line itself exists (strokeDasharray "6 5").
    const dashed = [...container.querySelectorAll('line')].find(
      (l) => l.getAttribute('stroke-dasharray') === '6 5',
    );
    expect(dashed).toBeTruthy();
    const lineY = Number(dashed!.getAttribute('y1'));
    expect(lineY).toBeGreaterThan(22);
    expect(lineY).toBeLessThan(284);
    // No payback callout — the curve never crosses the line.
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

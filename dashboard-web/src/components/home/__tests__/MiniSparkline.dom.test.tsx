// dashboard-web/src/components/home/__tests__/MiniSparkline.dom.test.tsx
//
// 2026-06-10 audit — two MiniSparkline visual-truth fixes:
//   1. c/HI-05 class: an all-equal series used to be glued to the BOTTOM of
//      the 30px box (reads "crashed to zero"); now it centers at H/2.
//   2. Paint order: the area gradient used to be drawn ON TOP of the stroke,
//      washing the line out exactly where values peak (the gradient is most
//      opaque at the top). Fill must come FIRST, stroke LAST.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MiniSparkline } from '@/components/home/CommandCenterHero';

const H = 30; // MiniSparkline's fixed viewBox height

describe('<MiniSparkline> (hero secondary-card spark)', () => {
  it('centers an all-equal series at the vertical midline (y = H/2), not the bottom', () => {
    const { container } = render(
      <MiniSparkline values={[7, 7, 7, 7]} stroke="var(--up)" />,
    );
    const line = container.querySelector('path[stroke]');
    expect(line).not.toBeNull();
    const d = line!.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeCloseTo(H / 2, 1);
      // The old bug pinned every point to H - PAD_Y (=27).
      expect(y).not.toBeCloseTo(H - 3, 1);
    }
  });

  it('draws the area FILL first and the STROKE last (line stays legible at peaks)', () => {
    const { container } = render(
      <MiniSparkline values={[1, 4, 2, 6]} stroke="var(--dn)" />,
    );
    const paths = [...container.querySelectorAll('path')];
    expect(paths.length).toBe(2);
    const [first, second] = paths;
    // First painted (visually underneath): the gradient area fill.
    expect(first.getAttribute('fill') ?? '').toContain('url(');
    expect(first.getAttribute('stroke')).toBeNull();
    // Last painted (on top): the stroke line.
    expect(second.getAttribute('fill')).toBe('none');
    expect(second.getAttribute('stroke')).toBeTruthy();
  });

  it('returns null for <2 finite points (contract)', () => {
    const { container } = render(<MiniSparkline values={[5]} stroke="var(--up)" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

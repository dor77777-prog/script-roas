// dashboard-web/src/components/operator/__tests__/CronTickSnapshotsViewer.dom.test.tsx
//
// W7-T6 (Horizon re-skin Wave 7) — smoke DOM tests for CronTickSnapshotsViewer.
//
// Two re-skin changes are pinned here:
//   1. The hand-rolled `<section border…rounded-lg>` became the shared glass
//      `<Card>`, and the inner "Cron-tick snapshots" heading was dropped
//      (ActivityTab self-titles the panel) — the "(N ticks אחרונים)" count
//      caption is kept so no info is lost.
//   2. The completed / skipped / failed counts no longer rely on COLOUR alone
//      (WCAG 1.4.1): each count now carries a leading lucide icon
//      (CheckCircle2 / AlertTriangle / XCircle), and the same icon repeats in
//      the column header. We assert the SVG icons are present in those cells.
//
// Mirrors FreshnessPanel.dom.test.tsx mock setup.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

let nextSwrResult: { data: unknown; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};
function setSwrResult(r: { data: unknown; isLoading: boolean }) {
  nextSwrResult = r;
}

vi.mock('swr', () => ({
  default: () => nextSwrResult,
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(),
}));

import { CronTickSnapshotsViewer } from '../CronTickSnapshotsViewer';
import type { CronTickSnapshotRow } from '@/lib/operator/registriesReaders';

beforeEach(() => {
  cleanup();
  setSwrResult({ data: undefined, isLoading: true });
});

function makeRow(overrides: Partial<CronTickSnapshotRow> = {}): CronTickSnapshotRow {
  const start = '2026-06-13T10:00:00.000Z';
  return {
    tick_id: 'tick_1',
    started_at: start,
    finished_at: '2026-06-13T10:00:05.000Z',
    fan_out_count: 18,
    events_completed_count: 16,
    events_skipped_count: 1,
    events_failed_count: 1,
    ...overrides,
  };
}

describe('<CronTickSnapshotsViewer>', () => {
  it('loading state renders the Card shell with a טוען… message', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<CronTickSnapshotsViewer />);
    expect(screen.getByTestId('cron-tick-snapshots')).toBeTruthy();
    expect(screen.getByText('טוען…')).toBeTruthy();
  });

  it('empty state renders the Card with the "no ticks yet" copy', () => {
    setSwrResult({ data: { rows: [] }, isLoading: false });
    render(<CronTickSnapshotsViewer />);
    const card = screen.getByTestId('cron-tick-snapshots');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('אין ticks עדיין');
  });

  it('renders rows inside a Card and keeps the ticks-count caption', () => {
    setSwrResult({
      data: { rows: [makeRow({ tick_id: 'tick_a' }), makeRow({ tick_id: 'tick_b' })] },
      isLoading: false,
    });
    render(<CronTickSnapshotsViewer />);

    const card = screen.getByTestId('cron-tick-snapshots');
    expect(card.className).toContain('glass'); // it's a real Card
    expect(card.textContent).toContain('(2 ticks אחרונים)');
    expect(card.textContent).toContain('tick_a');
    expect(card.textContent).toContain('tick_b');
  });

  it('count columns carry a non-colour cue (lucide icon) in each cell — not colour alone', () => {
    setSwrResult({
      data: {
        rows: [
          makeRow({
            tick_id: 'tick_x',
            events_completed_count: 16,
            events_skipped_count: 2,
            events_failed_count: 3,
          }),
        ],
      },
      isLoading: false,
    });
    render(<CronTickSnapshotsViewer />);

    const card = screen.getByTestId('cron-tick-snapshots');
    const dataRow = card.querySelector('tbody tr');
    expect(dataRow).toBeTruthy();
    const cells = within(dataRow as HTMLElement).getAllByRole('cell');
    // Columns: tick_id, fan_out, completed, skipped, failed, duration.
    const completedCell = cells[2];
    const skippedCell = cells[3];
    const failedCell = cells[4];

    // Each of the three coloured count cells carries a leading <svg> icon so
    // the outcome is legible without relying on hue (WCAG 1.4.1).
    expect(completedCell.querySelector('svg')).toBeTruthy();
    expect(skippedCell.querySelector('svg')).toBeTruthy();
    expect(failedCell.querySelector('svg')).toBeTruthy();

    // The numeric values still render alongside the icon (no info loss).
    expect(completedCell.textContent).toContain('16');
    expect(skippedCell.textContent).toContain('2');
    expect(failedCell.textContent).toContain('3');
  });
});

// dashboard-web/src/components/operator/__tests__/RunsPanel.dom.test.tsx
//
// DOM smoke tests for RunsPanel — the QStash/DB-backed "ריצות אחרונות"
// (recent runs / pipeline health) panel that replaced the removed Inngest
// JobsTable. Mirrors CronTickSnapshotsViewer.dom.test.tsx mock setup.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

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

import { RunsPanel } from '../RunsPanel';
import type { RunRow } from '@/lib/operator/runsSummary';

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    job: 'worker-meta',
    lastSuccessAt: '2026-06-22T09:59:00.000Z',
    lastAttemptAt: '2026-06-22T09:59:00.000Z',
    status: 'success',
    lastError: null,
    source: 'data_freshness',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  setSwrResult({ data: undefined, isLoading: true });
});

describe('<RunsPanel>', () => {
  it('loading state renders the panel shell with a loading message', () => {
    setSwrResult({ data: undefined, isLoading: true });
    render(<RunsPanel />);
    expect(screen.getByTestId('runs-panel')).toBeTruthy();
    expect(screen.getByTestId('runs-panel').textContent).toContain('טוען');
  });

  it('renders one row per job with a status pill', () => {
    setSwrResult({
      data: {
        rows: [
          row({ job: 'worker-meta', status: 'success' }),
          row({ job: 'worker-google', status: 'error', lastError: { code: 'AUTH', message: 'bad token' } }),
          row({ job: 'cron-live', status: 'unknown', source: 'none', lastSuccessAt: null }),
        ],
        lastUpdated: '2026-06-22T10:00:00.000Z',
      },
      isLoading: false,
    });
    render(<RunsPanel />);
    const panel = screen.getByTestId('runs-panel');
    expect(panel.textContent).toContain('worker-meta');
    expect(panel.textContent).toContain('worker-google');
    expect(panel.textContent).toContain('cron-live');
    // every data row carries a status pill (svg icon, non-colour cue)
    const dataRows = panel.querySelectorAll('tbody tr');
    expect(dataRows.length).toBeGreaterThanOrEqual(3);
    dataRows.forEach((tr) => expect(tr.querySelector('svg')).toBeTruthy());
  });

  it('shows an amber banner (no hard error) when data.error is present', () => {
    setSwrResult({
      data: { rows: [], error: 'הטעינה נכשלה: שגיאה לא צפויה.', lastUpdated: '2026-06-22T10:00:00.000Z' },
      isLoading: false,
    });
    render(<RunsPanel />);
    const panel = screen.getByTestId('runs-panel');
    expect(panel.textContent).toContain('הטעינה נכשלה: שגיאה לא צפויה.');
    // amber banner carries an alert icon
    expect(panel.querySelector('svg')).toBeTruthy();
  });

  it('expands an errored row to show the last-error JSON in an LTR <pre>', () => {
    setSwrResult({
      data: {
        rows: [row({ job: 'worker-meta', status: 'error', lastError: { code: 'AUTH_INVALID', message: 'token expired' } })],
        lastUpdated: '2026-06-22T10:00:00.000Z',
      },
      isLoading: false,
    });
    render(<RunsPanel />);
    const panel = screen.getByTestId('runs-panel');
    // detail not visible until expanded
    expect(panel.querySelector('pre')).toBeNull();
    const toggle = within(panel).getAllByRole('button')[0];
    fireEvent.click(toggle);
    const pre = panel.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.getAttribute('dir')).toBe('ltr');
    expect(pre!.textContent).toContain('AUTH_INVALID');
    expect(pre!.textContent).toContain('token expired');
  });
});

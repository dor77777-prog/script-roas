// dashboard-web/src/components/insights/__tests__/actionListPanelErrorState.dom.test.tsx
//
// P1-4c (2026-06-10 state-honesty sweep) — ActionListPanel `error` prop.
//
// Unit-level pin of the panel's body-state precedence: loading → error →
// all-clear. The green "אין פעולות דחופות כרגע. הכול נראה תקין." is allowed
// ONLY on settled SUCCESS with zero insights; when the parent reports a
// failed feed (error=true) the panel must render the neutral can't-analyze
// state instead of the false all-clear.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActionListPanel } from '@/components/insights/ActionListPanel';

afterEach(() => cleanup());

const noop = vi.fn();

describe('ActionListPanel — P1-4c error state precedence', () => {
  it('error=true + zero insights → neutral "לא ניתן לטעון תובנות כרגע", NOT the all-clear', () => {
    render(<ActionListPanel insights={[]} error onMark={noop} adAccounts={{}} />);

    const alert = screen.getByTestId('action-list-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('לא ניתן לטעון תובנות כרגע');
    expect(screen.queryByText(/אין פעולות דחופות כרגע/)).toBeNull();
    expect(screen.queryByText(/הכול נראה תקין/)).toBeNull();
  });

  it('loading takes precedence over error (no premature error flash mid-fetch)', () => {
    render(<ActionListPanel insights={[]} loading error onMark={noop} adAccounts={{}} />);

    expect(screen.getByText(/מנתח נתונים/)).toBeInTheDocument();
    expect(screen.queryByTestId('action-list-error')).toBeNull();
  });

  it('error=false + zero insights (settled success) → the all-clear still renders', () => {
    render(<ActionListPanel insights={[]} onMark={noop} adAccounts={{}} />);

    expect(screen.getByText(/אין פעולות דחופות כרגע/)).toBeInTheDocument();
    expect(screen.queryByTestId('action-list-error')).toBeNull();
  });
});

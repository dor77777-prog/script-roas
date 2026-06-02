import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useGoalSettings } from '@/lib/hooks/useGoalSettings';
import { readGoalSettings, GOAL_SETTINGS_KEY, GOAL_SETTINGS_EVENT } from '@/lib/goalSettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
beforeEach(() => { window.localStorage.clear(); });

function Harness() {
  const [settings, update] = useGoalSettings();
  return (
    <div>
      <span data-testid="count">{Object.keys(settings.byMonth).length}</span>
      <span data-testid="may">{settings.byMonth['2026-05'] ?? ''}</span>
      <button
        data-testid="set"
        onClick={() => update({ ...settings, byMonth: { ...settings.byMonth, '2026-05': 50000 } })}
      >set</button>
    </div>
  );
}

describe('useGoalSettings', () => {
  it('reads the empty default (no months) on first mount', () => {
    render(<Harness />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(screen.getByTestId('may').textContent).toBe('');
  });

  it('update() persists to localStorage and re-renders the hook', () => {
    render(<Harness />);
    act(() => { fireEvent.click(screen.getByTestId('set')); });
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('may').textContent).toBe('50000');
    expect(readGoalSettings().byMonth['2026-05']).toBe(50000);
  });

  it('re-reads on a roas-goal-changed event dispatched by another component', () => {
    render(<Harness />);
    // simulate an external write + event (e.g. cloud hydrate or sibling panel)
    act(() => {
      window.localStorage.setItem(
        GOAL_SETTINGS_KEY,
        JSON.stringify({ v: 1, byMonth: { '2026-05': 77000 } }),
      );
      window.dispatchEvent(new Event(GOAL_SETTINGS_EVENT));
    });
    expect(screen.getByTestId('may').textContent).toBe('77000');
  });

  it('re-reads on a storage event (cross-device cloud sync writes localStorage)', () => {
    render(<Harness />);
    act(() => {
      window.localStorage.setItem(
        GOAL_SETTINGS_KEY,
        JSON.stringify({ v: 1, byMonth: { '2026-05': 99000 } }),
      );
      window.dispatchEvent(new Event('storage'));
    });
    expect(screen.getByTestId('may').textContent).toBe('99000');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSalarySettings } from '@/lib/hooks/useSalarySettings';
import { readSalarySettings } from '@/lib/salarySettings';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
beforeEach(() => { window.localStorage.clear(); });

function Harness() {
  const [settings, update] = useSalarySettings();
  return (
    <div>
      <span data-testid="kind">{settings.default.kind}</span>
      <span data-testid="value">{settings.default.value}</span>
      <button
        data-testid="set"
        onClick={() => update({ ...settings, default: { kind: 'amount', value: 8000 } })}
      >set</button>
    </div>
  );
}

describe('useSalarySettings', () => {
  it('reads the 7% percent default on first mount', () => {
    render(<Harness />);
    expect(screen.getByTestId('kind').textContent).toBe('percent');
    expect(screen.getByTestId('value').textContent).toBe('7');
  });

  it('update() persists to localStorage and re-renders the hook', () => {
    render(<Harness />);
    act(() => { fireEvent.click(screen.getByTestId('set')); });
    expect(screen.getByTestId('kind').textContent).toBe('amount');
    expect(screen.getByTestId('value').textContent).toBe('8000');
    expect(readSalarySettings().default).toEqual({ kind: 'amount', value: 8000 });
  });

  it('re-reads on a roas-salary-changed event dispatched by another component', () => {
    render(<Harness />);
    // simulate an external write + event (e.g. cloud hydrate or sibling panel)
    act(() => {
      window.localStorage.setItem('roas-dashboard:salary-settings', JSON.stringify({ v: 1, default: { kind: 'percent', value: 12 }, byMonth: {} }));
      window.dispatchEvent(new Event('roas-salary-changed'));
    });
    expect(screen.getByTestId('value').textContent).toBe('12');
  });
});

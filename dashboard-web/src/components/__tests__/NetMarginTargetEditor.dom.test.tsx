import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NetMarginTargetEditor } from '@/components/NetMarginTargetEditor';
import { readNetMarginTargetSettings, effectiveNetMarginTarget } from '@/lib/netMarginTarget';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => cleanup());

describe('NetMarginTargetEditor', () => {
  it('renders the default 35% target with a "ברירת מחדל" tag when unset', () => {
    render(<NetMarginTargetEditor month="2026-06" />);
    expect(screen.getByTestId('net-margin-target-value').textContent).toContain('35%');
    expect(screen.getByTestId('net-margin-default-tag')).toBeTruthy();
  });

  it('editing the target persists byMonth[month] as a fraction and re-renders the value', () => {
    render(<NetMarginTargetEditor month="2026-06" />);
    fireEvent.click(screen.getByTestId('net-margin-target-edit'));
    const input = screen.getByTestId('net-margin-target-input') as HTMLInputElement;
    expect(input.value).toBe('35'); // seeded from current effective
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('net-margin-target-save'));

    // Persisted as a fraction.
    const s = readNetMarginTargetSettings();
    expect(s.byMonth['2026-06']).toBe(0.30);
    expect(effectiveNetMarginTarget(s, '2026-06').value).toBe(0.30);

    // Value re-rendered (back out of edit mode).
    expect(screen.getByTestId('net-margin-target-value').textContent).toContain('30%');
  });

  it('rejects an out-of-range percent (>100): save is disabled and nothing persists', () => {
    render(<NetMarginTargetEditor month="2026-06" />);
    fireEvent.click(screen.getByTestId('net-margin-target-edit'));
    const input = screen.getByTestId('net-margin-target-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    const save = screen.getByTestId('net-margin-target-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save); // no-op while disabled
    // Still editing, nothing persisted.
    expect(screen.getByTestId('net-margin-target-input')).toBeTruthy();
    expect(readNetMarginTargetSettings().byMonth['2026-06']).toBeUndefined();
  });

  it('empty draft clears THIS month override (default re-fills)', () => {
    // Seed an override first.
    window.localStorage.setItem('roas-dashboard:net-margin-target', JSON.stringify({ v: 1, default: 0.35, byMonth: { '2026-06': 0.40 } }));
    render(<NetMarginTargetEditor month="2026-06" />);
    expect(screen.getByTestId('net-margin-target-value').textContent).toContain('40%');
    fireEvent.click(screen.getByTestId('net-margin-target-edit'));
    fireEvent.change(screen.getByTestId('net-margin-target-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('net-margin-target-save'));
    expect(readNetMarginTargetSettings().byMonth['2026-06']).toBeUndefined();
    // Falls back to the default 35%.
    expect(screen.getByTestId('net-margin-target-value').textContent).toContain('35%');
  });
});

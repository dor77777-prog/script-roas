import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useReconcileAcks } from '@/lib/hooks/useReconcileAcks';
import { readReconcileAcks } from '@/lib/reconcileAckStore';
import { reconcileAckKey } from '@/lib/audit/reconcileAck';
import type { Violation } from '@/lib/audit/reconcile';

vi.mock('@/lib/cloudSync', () => ({ pushCloudKey: vi.fn() }));
beforeEach(() => { window.localStorage.clear(); });

const finding: Violation = {
  label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop',
  detail: 'data_daily 3219 vs orders_attribution 3869',
};

function Harness() {
  const { acks, ack, unack } = useReconcileAcks();
  return (
    <div>
      <span data-testid="count">{Object.keys(acks).length}</span>
      <button data-testid="ack" onClick={() => ack(finding)}>ack</button>
      <button data-testid="unack" onClick={() => unack(reconcileAckKey(finding))}>unack</button>
    </div>
  );
}

describe('useReconcileAcks', () => {
  it('starts empty, ack() persists + re-renders, unack() removes', () => {
    render(<Harness />);
    expect(screen.getByTestId('count').textContent).toBe('0');

    act(() => { fireEvent.click(screen.getByTestId('ack')); });
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(readReconcileAcks()[reconcileAckKey(finding)]).toBeDefined();

    act(() => { fireEvent.click(screen.getByTestId('unack')); });
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(readReconcileAcks()[reconcileAckKey(finding)]).toBeUndefined();
  });

  it('re-reads on the change event dispatched by another component / cloud hydrate', () => {
    render(<Harness />);
    act(() => {
      // simulate a sibling write + event
      window.localStorage.setItem(
        'roas-dashboard:reconcile-acks',
        JSON.stringify({ [reconcileAckKey(finding)]: { value: 650, ackedAt: 'x' } }),
      );
      window.dispatchEvent(new Event('roas-reconcile-acks-changed'));
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});

// @vitest-environment jsdom
//
// reconcileAckStore — localStorage + cloud-sync setter for reconcile acks
// (DQ-1 "mark reviewed"). Mirrors the campaignProductMap / netMarginTarget
// pattern: write localStorage, fire a change event, push to cloud immediately
// (an ack is a discrete operator action — the operator may refresh right after).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RECONCILE_ACKS_KEY,
  RECONCILE_ACKS_EVENT,
  readReconcileAcks,
  setReconcileAck,
  clearReconcileAck,
} from '@/lib/reconcileAckStore';
import { reconcileAckKey, findingMagnitude } from '@/lib/audit/reconcileAck';
import type { Violation } from '@/lib/audit/reconcile';

const pushCloudKey = vi.fn();
vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: (...args: unknown[]) => pushCloudKey(...args),
}));

beforeEach(() => {
  pushCloudKey.mockClear();
  window.localStorage.clear();
});

const finding: Violation = {
  label: 'INV-10 orders vs data revenue 2026-06-22/uzoshop',
  detail: 'data_daily 3219 vs orders_attribution 3869', // gap 650
};

describe('reconcileAckStore', () => {
  it('exposes the canonical key + event constants', () => {
    expect(RECONCILE_ACKS_KEY).toBe('roas-dashboard:reconcile-acks');
    expect(RECONCILE_ACKS_EVENT).toBe('roas-reconcile-acks-changed');
  });

  it('read with nothing stored → {}', () => {
    expect(readReconcileAcks()).toEqual({});
  });

  it('setReconcileAck writes localStorage, fires the event, and pushes to cloud IMMEDIATELY', () => {
    const evts: string[] = [];
    const onChange = (e: Event) => evts.push(e.type);
    window.addEventListener(RECONCILE_ACKS_EVENT, onChange);

    setReconcileAck(finding);

    const acks = readReconcileAcks();
    const key = reconcileAckKey(finding);
    expect(acks[key]).toBeDefined();
    expect(acks[key].value).toBe(findingMagnitude(finding)); // 650 captured at ack time
    expect(typeof acks[key].ackedAt).toBe('string');

    expect(evts).toContain(RECONCILE_ACKS_EVENT);
    // immediate cloud push through the SAME setter pattern as campaignProductMap.
    expect(pushCloudKey).toHaveBeenCalledWith(
      RECONCILE_ACKS_KEY,
      expect.objectContaining({ [key]: expect.objectContaining({ value: 650 }) }),
      { immediate: true },
    );

    window.removeEventListener(RECONCILE_ACKS_EVENT, onChange);
  });

  it('clearReconcileAck removes exactly that fingerprint and pushes the new map', () => {
    setReconcileAck(finding);
    pushCloudKey.mockClear();

    const key = reconcileAckKey(finding);
    clearReconcileAck(key);

    expect(readReconcileAcks()[key]).toBeUndefined();
    expect(pushCloudKey).toHaveBeenCalledWith(
      RECONCILE_ACKS_KEY,
      {},
      { immediate: true },
    );
  });

  it('round-trips multiple acks without clobbering each other', () => {
    const second: Violation = { label: 'INV-7 Meta spend 2026-06-22/zolplus', detail: 'data_daily 100 vs campaigns_daily 130' };
    setReconcileAck(finding);
    setReconcileAck(second);
    const acks = readReconcileAcks();
    expect(Object.keys(acks)).toHaveLength(2);
    expect(acks[reconcileAckKey(finding)]).toBeDefined();
    expect(acks[reconcileAckKey(second)]).toBeDefined();
  });

  it('malformed stored JSON → {} (never throws)', () => {
    window.localStorage.setItem(RECONCILE_ACKS_KEY, '{not json');
    expect(readReconcileAcks()).toEqual({});
  });
});

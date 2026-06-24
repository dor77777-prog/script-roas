'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  readReconcileAcks,
  setReconcileAck,
  clearReconcileAck,
  RECONCILE_ACKS_EVENT,
} from '@/lib/reconcileAckStore';
import type { ReconcileAcks } from '@/lib/audit/reconcileAck';
import type { Violation } from '@/lib/audit/reconcile';

/**
 * Reactive read of the reconcile acks (DQ-1 "mark reviewed"). Re-reads on
 * same-tab edits (the change event) AND cross-device cloud hydrate (the
 * `storage` event), so the operator panel + Home banner stay in lock-step the
 * moment an ack is added/removed on this or another device.
 */
export function useReconcileAcks(): {
  acks: ReconcileAcks;
  ack: (v: Violation) => void;
  unack: (fingerprint: string) => void;
} {
  const [acks, setAcks] = useState<ReconcileAcks>(() => readReconcileAcks());

  useEffect(() => {
    const reread = () => setAcks(readReconcileAcks());
    window.addEventListener(RECONCILE_ACKS_EVENT, reread);
    window.addEventListener('storage', reread);
    return () => {
      window.removeEventListener(RECONCILE_ACKS_EVENT, reread);
      window.removeEventListener('storage', reread);
    };
  }, []);

  const ack = useCallback((v: Violation) => { setAcks(setReconcileAck(v)); }, []);
  const unack = useCallback((fp: string) => { setAcks(clearReconcileAck(fp)); }, []);

  return { acks, ack, unack };
}

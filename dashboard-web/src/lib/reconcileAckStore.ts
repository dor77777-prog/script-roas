/**
 * reconcileAckStore — localStorage + cloud-sync persistence for reconcile acks
 * (DQ-1 "mark reviewed"). Mirrors campaignProductMap.ts exactly:
 *   - localStorage under the canonical `roas-dashboard:reconcile-acks` key,
 *   - a CustomEvent so mounted components re-read,
 *   - `pushCloudKey(..., { immediate: true })` because acking is a discrete
 *     operator action (the operator may refresh / close the tab right after the
 *     click; the immediate flag fires the POST before any reload can race it
 *     and let hydrateFromCloud overwrite the just-saved ack — same bug class
 *     campaignProductMap's immediate push was added to prevent).
 *
 * Registered in cloudSync.ts:STATE_KEYS + dashboardStateKeys.ts:ALLOWED_STATE_KEYS
 * (parity enforced by lib/__tests__/stateKeysParity.test.ts).
 *
 * The pure read/decide helpers (reconcileAckKey / findingMagnitude /
 * isFindingAcked / filterAckedFindings) live in audit/reconcileAck.ts and have
 * no DOM/storage dependency.
 */

import { pushCloudKey } from './cloudSync';
import {
  reconcileAckKey,
  findingMagnitude,
  type ReconcileAcks,
} from './audit/reconcileAck';
import type { Violation } from './audit/reconcile';

export const RECONCILE_ACKS_KEY = 'roas-dashboard:reconcile-acks' as const;
export const RECONCILE_ACKS_EVENT = 'roas-reconcile-acks-changed' as const;

/** Read the ack map from localStorage. Defensive — never throws. */
export function readReconcileAcks(): ReconcileAcks {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(RECONCILE_ACKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    // Keep only well-formed { value:number, ackedAt:string } entries.
    const clean: ReconcileAcks = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        v &&
        typeof v === 'object' &&
        typeof (v as { value?: unknown }).value === 'number' &&
        Number.isFinite((v as { value: number }).value) &&
        typeof (v as { ackedAt?: unknown }).ackedAt === 'string'
      ) {
        clean[k] = {
          value: (v as { value: number }).value,
          ackedAt: (v as { ackedAt: string }).ackedAt,
        };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Persist + cloud-sync (immediate) the ack map. */
function writeReconcileAcks(acks: ReconcileAcks): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECONCILE_ACKS_KEY, JSON.stringify(acks));
    window.dispatchEvent(
      new (window.CustomEvent ?? CustomEvent)(RECONCILE_ACKS_EVENT),
    );
    // immediate: an ack is a discrete "Save"-like action — see header note.
    pushCloudKey(RECONCILE_ACKS_KEY, acks, { immediate: true });
  } catch {
    /* quota / private mode — local-only failure, ignore */
  }
}

/**
 * Mark a finding reviewed: capture its CURRENT gap magnitude as the baseline so
 * a later material worsening re-pops it (see isFindingAcked). Returns the new
 * ack map.
 */
export function setReconcileAck(v: Violation): ReconcileAcks {
  const acks = readReconcileAcks();
  acks[reconcileAckKey(v)] = {
    value: findingMagnitude(v),
    ackedAt: new Date().toISOString(),
  };
  writeReconcileAcks(acks);
  return acks;
}

/** Un-ack (undo) a single fingerprint so the finding can be reviewed again. */
export function clearReconcileAck(fingerprint: string): ReconcileAcks {
  const acks = readReconcileAcks();
  if (fingerprint in acks) {
    delete acks[fingerprint];
    writeReconcileAcks(acks);
  }
  return acks;
}

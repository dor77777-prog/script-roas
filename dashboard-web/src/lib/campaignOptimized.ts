/**
 * Campaign "optimized" marks — purely UX. The user works through campaigns
 * during their optimization pass and marks the ones they've already handled,
 * so subsequent rounds skip them at a glance.
 *
 * No effect on any calculation. Stored as a set of composite keys
 * (`storeId::platform::campaignId` for campaign mode,
 *  `storeId::platform::campaignId::adSetId` for ad-set mode) — same shape as
 * the `key` field on the Aggregated row in CampaignsTable.
 *
 * Synced cross-device via cloudSync (registered in STATE_KEYS).
 */

import { pushCloudKey } from './cloudSync';

const STORAGE_KEY = 'roas-dashboard:campaign-optimized' as const;

/** Lightweight wrapper around localStorage that produces an empty Set when
 *  the value is missing, malformed, or the env is SSR. */
export function readOptimized(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(s => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

/** Write the full set back. Persists locally AND pushes to cloud. */
export function writeOptimized(set: Set<string>) {
  if (typeof window === 'undefined') return;
  const arr = Array.from(set);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent('roas-campaign-optimized-changed'));
    pushCloudKey(STORAGE_KEY, arr);
  } catch {
    /* quota / private mode — local-only sync continues without throwing */
  }
}

/** Flip one key in place. Returns the new set so callers can stash it in
 *  React state without a follow-up read. */
export function toggleOptimized(key: string, current: Set<string>): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  writeOptimized(next);
  return next;
}

/** Remove every mark in one shot. Used by the header "clear all" action. */
export function clearAllOptimized(): Set<string> {
  const empty = new Set<string>();
  writeOptimized(empty);
  return empty;
}

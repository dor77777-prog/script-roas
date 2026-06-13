'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  readNetMarginTargetSettings, writeNetMarginTargetSettings,
  effectiveNetMarginTarget, NET_MARGIN_TARGET_EVENT,
  DEFAULT_NET_MARGIN_TARGET, type NetMarginTargetSettings,
} from '@/lib/netMarginTarget';

/** Reactive read of the net-margin target settings: re-reads on same-tab edits + cloud hydrate. */
export function useNetMarginTargetSettings(): [NetMarginTargetSettings, (next: NetMarginTargetSettings) => void] {
  const [settings, setSettings] = useState<NetMarginTargetSettings>(() => readNetMarginTargetSettings());
  useEffect(() => {
    const reread = () => setSettings(readNetMarginTargetSettings());
    window.addEventListener(NET_MARGIN_TARGET_EVENT, reread);
    // Cloud sync writes localStorage from another device → 'storage' event.
    window.addEventListener('storage', reread);
    return () => { window.removeEventListener(NET_MARGIN_TARGET_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  const update = useCallback((next: NetMarginTargetSettings) => { writeNetMarginTargetSettings(next); setSettings(next); }, []);
  return [settings, update];
}

/**
 * Convenience hook returning the EFFECTIVE target fraction for a given 'YYYY-MM'
 * (exact → carry-forward → default 0.35), plus the full settings + setter so a
 * caller can edit. Threaded into `synthesizePnl({ targetMargin })`.
 */
export function useNetMarginTarget(month: string): {
  target: number;
  carriedFrom: string | null;
  settings: NetMarginTargetSettings;
  setSettings: (next: NetMarginTargetSettings) => void;
} {
  const [settings, setSettings] = useNetMarginTargetSettings();
  const eff = month
    ? effectiveNetMarginTarget(settings, month)
    : { value: settings.default ?? DEFAULT_NET_MARGIN_TARGET, carriedFrom: null };
  return { target: eff.value, carriedFrom: eff.carriedFrom, settings, setSettings };
}

'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { DailyRow } from '@/lib/types';
import {
  readCogsSettings, writeCogsSettings, applyCogsToRows,
  COGS_SETTINGS_EVENT, type CogsSettings,
} from '@/lib/cogsSettings';

/** Reactive read of the COGS settings: re-reads on same-tab edits + cloud hydrate. */
export function useCogsSettings(): [CogsSettings, (next: CogsSettings) => void] {
  const [settings, setSettings] = useState<CogsSettings>(() => readCogsSettings());
  useEffect(() => {
    const reread = () => setSettings(readCogsSettings());
    window.addEventListener(COGS_SETTINGS_EVENT, reread);
    // Cloud sync writes localStorage from another device → 'storage' event.
    window.addEventListener('storage', reread);
    return () => { window.removeEventListener(COGS_SETTINGS_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  const update = useCallback((next: CogsSettings) => { writeCogsSettings(next); setSettings(next); }, []);
  return [settings, update];
}

/** Apply the COGS override to a rows array reactively. Returns the SAME ref when
 *  rows is nullish so callers can `?? []` as before. */
export function useCogsAdjustedRows<T extends DailyRow>(rows: T[] | undefined): T[] | undefined {
  const [settings] = useCogsSettings();
  return useMemo(() => (rows ? (applyCogsToRows(rows, settings) as T[]) : rows), [rows, settings]);
}

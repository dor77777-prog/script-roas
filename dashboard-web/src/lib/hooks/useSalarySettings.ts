'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  readSalarySettings, writeSalarySettings,
  SALARY_SETTINGS_EVENT, type SalarySettings,
} from '@/lib/salarySettings';

/** Reactive read of the salary settings: re-reads on same-tab edits + cloud hydrate. */
export function useSalarySettings(): [SalarySettings, (next: SalarySettings) => void] {
  const [settings, setSettings] = useState<SalarySettings>(() => readSalarySettings());
  useEffect(() => {
    const reread = () => setSettings(readSalarySettings());
    window.addEventListener(SALARY_SETTINGS_EVENT, reread);
    window.addEventListener('storage', reread); // cross-device cloud sync writes localStorage
    return () => { window.removeEventListener(SALARY_SETTINGS_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  const update = useCallback((next: SalarySettings) => { writeSalarySettings(next); setSettings(next); }, []);
  return [settings, update];
}

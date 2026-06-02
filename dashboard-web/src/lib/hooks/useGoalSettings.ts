'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  readGoalSettings, writeGoalSettings,
  GOAL_SETTINGS_EVENT, type GoalSettings,
} from '@/lib/goalSettings';

/** Reactive read of the per-month goal settings: re-reads on same-tab edits + cloud hydrate. */
export function useGoalSettings(): [GoalSettings, (next: GoalSettings) => void] {
  const [settings, setSettings] = useState<GoalSettings>(() => readGoalSettings());
  useEffect(() => {
    const reread = () => setSettings(readGoalSettings());
    window.addEventListener(GOAL_SETTINGS_EVENT, reread);
    // Cloud sync writes localStorage from another device → 'storage' event.
    window.addEventListener('storage', reread);
    return () => { window.removeEventListener(GOAL_SETTINGS_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  const update = useCallback((next: GoalSettings) => { writeGoalSettings(next); setSettings(next); }, []);
  return [settings, update];
}

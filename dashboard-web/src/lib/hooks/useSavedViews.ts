'use client';
import { useEffect, useState } from 'react';
import {
  readSavedViews,
  SAVED_VIEWS_EVENT,
  type SavedViewsState,
} from '@/lib/savedViews';

/** Reactive read of the saved views: re-reads on same-tab edits + cloud hydrate. */
export function useSavedViews(): SavedViewsState {
  const [state, setState] = useState<SavedViewsState>(() => readSavedViews());
  useEffect(() => {
    const reread = () => setState(readSavedViews());
    window.addEventListener(SAVED_VIEWS_EVENT, reread);
    window.addEventListener('storage', reread); // cross-device cloud sync writes localStorage
    return () => { window.removeEventListener(SAVED_VIEWS_EVENT, reread); window.removeEventListener('storage', reread); };
  }, []);
  return state;
}

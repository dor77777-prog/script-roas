'use client';

import { useEffect } from 'react';
import { hydrateFromCloud } from '@/lib/cloudSync';

/**
 * Invisible component that pulls cloud state on mount and re-polls every 30s.
 * Mounted once at the dashboard root so every device stays in sync without
 * each component having to think about it.
 */
export function CloudSync() {
  useEffect(() => {
    let cancelled = false;
    void hydrateFromCloud();

    const tick = () => {
      if (cancelled) return;
      void hydrateFromCloud();
    };

    // Poll every 30s. Tab not focused → browsers throttle intervals which is
    // fine; the next focus also triggers a fetch via the focus listener.
    const interval = setInterval(tick, 30_000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return null;
}

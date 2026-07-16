// dashboard-web/src/lib/notifications/fxFailure.ts
//
// DQ-2 (2026-06-04) — operator alert when an FX (Frankfurter) rate lookup
// fails. Previously the Meta/TikTok CAD adapters swallowed the failure with a
// silent `return 0`, so an FX outage silently zeroed that account's CAD spend
// (→ understated spend/ROAS/net) with NO operator signal. This routes the
// failure through the EXISTING token-failure alert path (provider 'fx', store
// 'global'), so it inherits the (provider, store, operation) ~6h throttle —
// one page per outage window, never per-conversion. Never throws (alerting
// must not break the conversion path).

import { notifyTokenFailure, type TokenFailureInput } from './tokenFailures';

export async function notifyFxFailure(input: {
  /** The source currency that failed to convert to CAD (e.g. 'USD', 'ILS'). */
  currency: string;
  /** 'YYYY-MM-DD' the rate was requested for. */
  dateStr: string;
  /** Raw error / reason (Frankfurter status text, or 'invalid rate N'). */
  errorMsg: string;
  /** Injectable for tests; defaults to the real throttled notifier. */
  notify?: (i: TokenFailureInput) => Promise<unknown>;
}): Promise<void> {
  const notify = input.notify ?? notifyTokenFailure;
  try {
    await notify({
      provider: 'fx',
      storeId: 'global',
      operation: 'fx_rate_failure',
      errorMsg: `FX ${input.currency}->CAD on ${input.dateStr} failed: ${input.errorMsg}`,
      // P1-11 (2026-06-10) changed the failure behavior: adapters return null
      // and the writers OMIT the *_cad keys, so the dashboard PRESERVES the
      // last good CAD numbers (stale > wrong) while non-CAD metrics keep
      // refreshing. The old "fell back to 0 / understated" copy predated that
      // contract and misdescribed the impact (2026-06-11 incident).
      // 2026-07-16: getFxRate walks a 3-provider chain (Frankfurter →
      // currency-api via jsDelivr → pages.dev mirror), so this alert now
      // means the WHOLE chain failed — rare and worth looking at, unlike the
      // old daily Frankfurter-nightly-522 noise (alert #55, seen 230×).
      advice:
        'ALL FX rate providers (Frankfurter + currency-api on jsDelivr + ' +
        'pages.dev mirror) failed — CAD conversion is paused for this run and ' +
        'the dashboard keeps showing the LAST GOOD CAD values (slightly ' +
        'stale, never zeroed); non-CAD metrics keep refreshing. A whole-chain ' +
        'failure is unusual — check network/DNS and the providers\' status.',
    });
  } catch {
    // Alerting must never break the FX/conversion path.
  }
}

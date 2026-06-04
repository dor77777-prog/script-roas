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
      advice:
        'The FX rate provider (Frankfurter) failed — CAD conversion fell back to 0 ' +
        'for this run, so spend/ROAS/net may be understated until it recovers. ' +
        'Usually transient; if it persists, check the FX provider status.',
    });
  } catch {
    // Alerting must never break the FX/conversion path.
  }
}

// dashboard-web/src/lib/sentry/scrub.ts
//
// Phase 13.2 (2026-05-24) — Sentry beforeSend PII scrubber.
//
// CLIENT-SAFE: this file imports only @sentry/nextjs *types*, so it can
// be loaded from sentry.client.config.ts without pulling notifyTokenFailure
// or any other server-only module into the client bundle.
//
// What it scrubs (regex patterns applied to event.message,
// event.exception.values[].value, and event.breadcrumbs[].message):
//
//   1. `access_token=...` or `"access_token":"..."` assignments  → keyword + value replaced
//   2. `refresh_token=...` or `"refresh_token":"..."` assignments → keyword + value replaced
//   3. `Bearer XYZ`                                              → "Bearer + value" replaced
//   4. `+<country code><10-15 digits>` phone numbers              → entire match replaced
//
// What it also does:
//   - Deletes `event.request.data` (the request body) when the URL matches
//     /api/operator/* — operator routes accept mutation payloads that
//     can include override secrets or recipient phone numbers.

import type * as Sentry from '@sentry/nextjs';

// Combined pattern. Order matters: more-specific keyword+value patterns
// before bare keywords so the keyword+value form is the one that matches.
const SCRUB_RE = new RegExp(
  [
    // access_token=value, "access_token":"value", access_token: value
    // Allows optional closing quote on the keyword side (JSON-style keys),
    // optional opening quote on the value side, and matches non-delimiter
    // chars until a quote/comma/whitespace/bracket terminates the value.
    String.raw`(?:refresh_token|access_token)['"]?\s*[=:]\s*['"]?[^\s,'"}\]]+['"]?`,
    // Bearer XYZ
    String.raw`Bearer\s+\S+`,
    // +countrycode phone numbers (10-15 digits)
    String.raw`\+\d{10,15}`,
  ].join('|'),
  'gi',
);
const REDACTED = '[REDACTED]';

function scrubString(s: string): string {
  return s.replace(SCRUB_RE, REDACTED);
}

export function buildBeforeSend() {
  return (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
    if (event.message) event.message = scrubString(event.message);
    for (const v of event.exception?.values ?? []) {
      if (v.value) v.value = scrubString(v.value);
    }
    for (const b of event.breadcrumbs ?? []) {
      if (b.message) b.message = scrubString(b.message);
    }
    if (event.request?.url && /\/api\/operator\//.test(event.request.url)) {
      delete event.request.data;
    }
    return event;
  };
}

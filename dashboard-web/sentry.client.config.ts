import * as Sentry from '@sentry/nextjs';
import { buildBeforeSend } from './src/lib/sentry/scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1, // 10% — enough for debugging, conserves quota
    environment: process.env.NODE_ENV,
    beforeSend: buildBeforeSend(),
    // No replay integration — error context comes from breadcrumbs only.
    // Session replay would capture DOM mutations, click coordinates, scroll
    // behaviour, and full URL paths (UTM identifiers, store IDs, date ranges),
    // which is likely PII processing in our EU/Canada B2B context and would
    // require a documented consent UX. Drop until that UX exists (WR-03 in
    // 02-foundations/02-REVIEW.md; privacy implications also noted in
    // dashboard-web/README.md). To re-enable later, add `replayIntegration`
    // back AND wire up consent + privacy-policy copy first.
  });
}
// If dsn is empty → no init. Silent no-op in localhost — no warnings, no logs.

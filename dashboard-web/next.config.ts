import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No `experimental.serverActions` block — the dashboard has no Server
  // Actions; all mutations go through `route.ts` POST handlers, which use
  // a separate request-body limit. Reintroduce only when a Server Action
  // is actually added. (IN-04)
};

// Sentry build-time wrapper. Without SENTRY_AUTH_TOKEN, the wrapper won't
// upload sourcemaps — but runtime instrumentation still works. Gated behavior
// is controlled by process.env alone.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI, // Show logs in CI; silent in localhost
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
});

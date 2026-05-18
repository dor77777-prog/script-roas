import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

// Sentry build-time wrapper. Without SENTRY_AUTH_TOKEN, the wrapper won't
// upload sourcemaps — but runtime instrumentation still works. Gated behavior
// is controlled by process.env alone.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI, // Show logs in CI; silent in localhost
  widenClientFileUpload: true,
  hideSourceMaps: true,
  disableLogger: true,
});

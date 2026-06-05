import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cost (2026-06-05): skip ESLint + TypeScript checking during `next build`
  // on Vercel. The pre-push gate (.husky/pre-push) already runs `tsc --noEmit`,
  // both vitest suites and `npm run lint` before EVERY push, so `main` is always
  // type-clean and lint-clean. Re-running them inside the Vercel build is pure
  // redundant Build-CPU spend (the single largest Vercel infra line). The gate
  // is the source of truth; this removes the duplicate work, not the check.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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

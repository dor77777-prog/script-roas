# Sentry SDK 8 → 10 Upgrade — Design Spec

**Date:** 2026-05-25
**Phase ID:** 13.2.1 (Sentry SDK upgrade — deferred sub-phase from 13.2 observability baseline)
**Severity:** HIGH CVE (GHSA-mw96-cpmx-2vgc — rollup path traversal via transitive `@sentry/nextjs ^8.40.0`)
**Scope:** Bump `@sentry/nextjs` from `^8.40.0` to `^10.x` (latest stable). No behavior changes — keep `tracesSampleRate: 0.1`, `beforeSend` scrubber, all capture sites unchanged.

## Background

The MT audit Track 1 P1-05 flagged `@sentry/nextjs ^8.40.0` as carrying the HIGH GHSA-mw96-cpmx-2vgc vulnerability. The fix is a version bump. The audit recommended `^10.53.1` at audit time; today we'll take whatever the latest `^10.x` is.

Sentry v9 → v10 introduced OpenTelemetry-based tracing by default. For our use (errors only, `tracesSampleRate: 0.1`, no profiling/replay), the change is invisible at the API surface. The APIs we call (`Sentry.init`, `Sentry.captureException`, `captureRequestError`, `withSentryConfig`, `beforeSend`) are stable across v8/v9/v10.

The risk surface is small:
- `withSentryConfig` options may have shuffled (some moved under nested `sourcemaps:` or `_experimental:` keys in v9+).
- The `Sentry.ErrorEvent` type used in `lib/sentry/scrub.ts` may have been renamed.
- `lib/__tests__/sentryScrub.test.ts` + `sentryCapture.test.ts` mock `@sentry/nextjs`; the mock shape may need tweaks if the export surface changed.

## Goal

After this phase:
- `npm audit` no longer reports `GHSA-mw96-cpmx-2vgc` against `@sentry/nextjs`.
- `npm run build` and `npm test` both pass.
- Prod runtime behavior is functionally identical (same DSN, same sampling, same scrubbing).

## Non-goals

- Adding new Sentry integrations (replay, profiling, session tracking).
- Adjusting `tracesSampleRate`.
- Curating `ignoreErrors` / `denyUrls`.
- Refactoring how we use Sentry beyond what the version bump requires.

## Architecture — chosen approach

Single direct bump to latest `^10.x` — skip v9 intermediary. The CVE is fixed in v10; v9 is a stepping-stone with its own breaking changes that we'd have to navigate twice.

### Change set

1. **`dashboard-web/package.json`** — bump `"@sentry/nextjs": "^8.40.0"` → `"^10.x.x"` (latest).
2. **`next.config.ts`** (potentially) — update `withSentryConfig` options if v10 reshuffled them. The current options (`org`, `project`, `silent`, `widenClientFileUpload`, `hideSourceMaps`, `disableLogger`) may have moved under nested keys.
3. **`sentry.{server,client,edge}.config.ts`** (potentially) — `Sentry.init` signature should be stable; only update if v10's typings introduce new required fields or rename existing ones.
4. **`lib/sentry/scrub.ts`** (potentially) — `Sentry.ErrorEvent` type may have been renamed (e.g. to `ErrorEvent` from the root). If so, fix the import.
5. **`lib/__tests__/sentryScrub.test.ts` + `sentryCapture.test.ts`** (potentially) — mock factories may need adjustment if exports changed.

The approach is iterative — bump, build, fix what breaks, repeat until green.

### Alternatives considered (and why rejected)

- **8 → 9 → 10 two-step:** doubles the work for no net benefit. The CVE is in v8; v9 also has its own breaking changes we'd have to navigate.
- **Pin to `^9.x`:** doesn't necessarily resolve the CVE (depends on which transitive rollup version v9 pulls in). Best to go straight to v10 where the fix is confirmed.
- **Defer to a future phase:** the CVE is HIGH severity — sitting on it accumulates risk.

## Test plan

- `npm install` — clean install, no peer dep warnings (or only known/acceptable ones).
- `npm audit` — confirm GHSA-mw96-cpmx-2vgc no longer reports against `@sentry/nextjs`.
- `npm run build` — clean Next.js build with the v10 wrapper.
- `npm test` — all 1096 existing tests pass (no behavior change expected).
- Pre-push hook (tsc + vitest + lint + docs-currency) — passes.
- Post-deploy prod smoke:
  - `/` → 200 OK.
  - `/api/health` → 200 OK.
  - `/api/debug/shopify-fetch` → 404 (env-gated, unchanged).

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `withSentryConfig` option keys renamed | Read v10 migration guide; reshape options; fall back to omitting unrecognized keys if the typings reject them. |
| `Sentry.ErrorEvent` type renamed → scrub.ts TS error | Fix import; the helper logic is type-only at this layer. |
| Vitest mocks (`vi.mock('@sentry/nextjs', () => ...)`) miss new exports | If existing tests use `captureException` only, the mocks remain valid. Update if a new test fixture is needed. |
| Bundle size regression (v10 adds OpenTelemetry by default) | `next build` output table shows First Load JS. If ≥20% increase, evaluate disabling `tracing` integration via `Sentry.init({ integrations: [] })` or similar. |
| New peer dep warnings (e.g. Next 15 vs Sentry 10) | `npm install` will surface. If there's a real incompatibility, defer the bump; if just noisy warnings, document and proceed. |

## Files touched (estimate)

| File | Action | LOC |
|------|--------|-----|
| `dashboard-web/package.json` | Modify | ~1 |
| `dashboard-web/package-lock.json` | Regenerated by npm install | — |
| `dashboard-web/next.config.ts` | Modify (if options changed) | ~5 |
| `dashboard-web/sentry.{server,client,edge}.config.ts` | Modify (if init signature changed) | ~6 |
| `dashboard-web/src/lib/sentry/scrub.ts` | Modify (if `ErrorEvent` renamed) | ~2 |
| `dashboard-web/src/lib/__tests__/sentryScrub.test.ts` | Modify (if mock shape changed) | ~5 |

Total: 1-6 files, ~20 LOC at most. The dominant change is the package-lock regeneration.

## Rollout

- Single commit on worktree branch `phase-13.2.1-sentry-sdk-upgrade`.
- Conventional commit: `chore(deps): bump @sentry/nextjs 8.40 → 10.x — fix GHSA-mw96-cpmx-2vgc (Phase 13.2.1)`.
- Merge to main → auto-deploy via Vercel git integration (now correctly using `$VERCEL_GIT_PREVIOUS_SHA`).

## Open questions

None.

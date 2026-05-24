// scripts/lib/docs-currency-rules.mjs
//
// Phase 13.3 — pure rule-checker for the docs-currency pre-push gate.
//
// Input: an array of file paths (typically from `git diff --name-only`).
// Output: { ok: boolean, violations: string[] }.
//
// Two rules:
//   UX rule:   touching operator-facing UI (components/*.tsx outside
//              __tests__, app/**/page.tsx, app/**/layout.tsx) requires
//              docs/ROAS-Dashboard-User-Manual.md in the diff.
//   Arch rule: touching pipeline code (inngest functions, supabase
//              migrations, lib/fetchers/*, lib/postgresReaders.ts)
//              requires docs/ARCHITECTURE.md.
//
// The pure function is split from the CLI runner so it can be unit-
// tested in vitest without spawning git or relying on filesystem state.

const USER_MANUAL = 'docs/ROAS-Dashboard-User-Manual.md';
const ARCH_DOC = 'docs/ARCHITECTURE.md';

function isUxFile(path) {
  if (path.includes('/__tests__/')) return false;
  if (/^dashboard-web\/src\/components\/.+\.(ts|tsx)$/.test(path)) return true;
  if (/^dashboard-web\/src\/app\/.*\/(page|layout)\.tsx$/.test(path)) return true;
  return false;
}

function isArchFile(path) {
  if (path.includes('/__tests__/')) return false;
  if (/^dashboard-web\/src\/inngest\/.+\.ts$/.test(path)) return true;
  if (/^supabase\/migrations\/.+\.sql$/.test(path)) return true;
  if (/^dashboard-web\/src\/lib\/fetchers\/.+\.ts$/.test(path)) return true;
  if (path === 'dashboard-web/src/lib/postgresReaders.ts') return true;
  return false;
}

/**
 * Check whether the given changed-file list satisfies the docs-currency
 * rules. Returns { ok, violations[] }. A non-empty violations array means
 * the gate should fail; messages are human-readable.
 */
export function checkDocsCurrency(files) {
  const set = new Set(files);
  const uxOffenders = files.filter(isUxFile);
  const archOffenders = files.filter(isArchFile);
  const violations = [];
  if (uxOffenders.length > 0 && !set.has(USER_MANUAL)) {
    violations.push(
      `User Manual must be updated. UX files changed: ${uxOffenders.join(', ')}. ` +
      `Required doc not updated: ${USER_MANUAL}.`,
    );
  }
  if (archOffenders.length > 0 && !set.has(ARCH_DOC)) {
    violations.push(
      `Architecture doc must be updated. Architecture-impacting files changed: ${archOffenders.join(', ')}. ` +
      `Required doc not updated: ${ARCH_DOC}.`,
    );
  }
  return { ok: violations.length === 0, violations };
}

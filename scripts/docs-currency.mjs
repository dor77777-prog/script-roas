#!/usr/bin/env node
// scripts/docs-currency.mjs
//
// Phase 13.3 — CLI entry point for the docs-currency pre-push gate.
// Pure rule logic lives in scripts/lib/docs-currency-rules.mjs (vitest-
// tested). This wrapper:
//   1. Resolves the list of changed files (HEAD vs origin/main; fallback
//      to HEAD vs HEAD~1 when the upstream is unreachable, e.g. first
//      push of a branch).
//   2. Calls checkDocsCurrency(files).
//   3. Prints any violations + the --no-verify escape hatch, exits 1.

import { execSync } from 'node:child_process';
import { checkDocsCurrency } from './lib/docs-currency-rules.mjs';

function diffFiles() {
  // Try comparing against origin/main first. If that fetch fails (offline,
  // ahead-only branch, etc.), fall back to HEAD~1.
  try {
    const out = execSync('git diff --name-only origin/main..HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    try {
      const out = execSync('git diff --name-only HEAD~1..HEAD', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.split('\n').map(s => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
}

const files = diffFiles();
const { ok, violations } = checkDocsCurrency(files);

if (!ok) {
  console.error('✗ docs-currency gate failed:');
  for (const v of violations) {
    console.error('  - ' + v);
  }
  console.error('');
  console.error('If this push is a no-UX-impact refactor (e.g. internal');
  console.error('rename, test-only change, code-comment fix), bypass with:');
  console.error('  git push --no-verify');
  console.error('(Routine use is discouraged per project memory rule.)');
  process.exit(1);
}

process.exit(0);

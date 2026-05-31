#!/usr/bin/env node
// dashboard-web/scripts/codemod-physical-to-logical.mjs
//
// Wave-4 Task 4.4 — Codemod physical-direction Tailwind classes to
// their logical equivalents so RTL Hebrew flips them correctly.
//
// Replacement table (token-boundary aware):
//   ml-*           → ms-*           (margin-inline-start)
//   mr-*           → me-*           (margin-inline-end)
//   pl-*           → ps-*           (padding-inline-start)
//   pr-*           → pe-*           (padding-inline-end)
//   left-*         → start-*        (inset-inline-start)
//   right-*        → end-*          (inset-inline-end)
//   border-l[-*]   → border-s[-*]   (border-inline-start)
//   border-r[-*]   → border-e[-*]   (border-inline-end)
//   rounded-l[-*]  → rounded-s[-*]  (border-start-radii)
//   rounded-r[-*]  → rounded-e[-*]  (border-end-radii)
//   text-right     → text-end
//   text-left      → text-start
//
// Scope (deliberately narrow — verified by Task-4.4 audit):
//   Only rewrites the *contents* of `className="…"` double-quoted JSX
//   attributes. Comments, `key="…"` strings, `dir="rtl"` literals, and
//   className brace-expressions like `className={cn(…)}` are NOT touched
//   here. The audit confirmed every physical-direction hit in this
//   codebase lives inside a literal className="…" string.
//
// Usage:
//   node scripts/codemod-physical-to-logical.mjs        # write
//   node scripts/codemod-physical-to-logical.mjs --dry  # report only

import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, '../..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');
const DRY_RUN = process.argv.includes('--dry');

// Order matters: most-specific patterns first.
const CLASS_RULES = [
  // border-l-… / border-r-… (width-modifier suffix)
  [/(?<![A-Za-z0-9_-])border-l-(?=[A-Za-z0-9])/g, 'border-s-'],
  [/(?<![A-Za-z0-9_-])border-r-(?=[A-Za-z0-9])/g, 'border-e-'],
  // border-l / border-r (no suffix)
  [/(?<![A-Za-z0-9_-])border-l(?![A-Za-z0-9_-])/g, 'border-s'],
  [/(?<![A-Za-z0-9_-])border-r(?![A-Za-z0-9_-])/g, 'border-e'],
  // rounded-l-… / rounded-r-…
  [/(?<![A-Za-z0-9_-])rounded-l-(?=[A-Za-z0-9])/g, 'rounded-s-'],
  [/(?<![A-Za-z0-9_-])rounded-r-(?=[A-Za-z0-9])/g, 'rounded-e-'],
  // rounded-l / rounded-r
  [/(?<![A-Za-z0-9_-])rounded-l(?![A-Za-z0-9_-])/g, 'rounded-s'],
  [/(?<![A-Za-z0-9_-])rounded-r(?![A-Za-z0-9_-])/g, 'rounded-e'],
  // text-right / text-left
  [/(?<![A-Za-z0-9_-])text-right(?![A-Za-z0-9_-])/g, 'text-end'],
  [/(?<![A-Za-z0-9_-])text-left(?![A-Za-z0-9_-])/g, 'text-start'],
  // ml-… / mr-… / pl-… / pr-… (suffix is a number, fraction, bracket, or `auto`)
  [/(?<![A-Za-z0-9_-])ml-(?=[A-Za-z0-9[])/g, 'ms-'],
  [/(?<![A-Za-z0-9_-])mr-(?=[A-Za-z0-9[])/g, 'me-'],
  [/(?<![A-Za-z0-9_-])pl-(?=[A-Za-z0-9[])/g, 'ps-'],
  [/(?<![A-Za-z0-9_-])pr-(?=[A-Za-z0-9[])/g, 'pe-'],
  // left-N / right-N (inset utilities — must come AFTER border-l/r above)
  [/(?<![A-Za-z0-9_-])left-(?=[A-Za-z0-9[])/g, 'start-'],
  [/(?<![A-Za-z0-9_-])right-(?=[A-Za-z0-9[])/g, 'end-'],
];

function rewriteInside(s) {
  let out = s;
  for (const [re, to] of CLASS_RULES) out = out.replace(re, to);
  return out;
}

// One big regex: `className="..."` — capture content, rewrite, splice
// back. We use a non-greedy match and require the closing quote to be
// unescaped (the class string never contains backslash-escapes in JSX
// attributes, so a plain `[^"]*` is sufficient).
const CLASSNAME_ATTR = /className="([^"]*)"/g;

function rewriteSource(src) {
  return src.replace(CLASSNAME_ATTR, (full, inner) => {
    const rewritten = rewriteInside(inner);
    return rewritten === inner ? full : `className="${rewritten}"`;
  });
}

// --- main ---------------------------------------------------------------

function listFiles(root) {
  return globSync('**/*.{ts,tsx}', { cwd: root })
    .map((p) => resolve(root, p))
    .filter((p) => !p.includes('__tests__'))
    .filter((p) => !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'));
}

function approxDelta(a, b) {
  const tokens = [
    'ml-', 'mr-', 'pl-', 'pr-', 'left-', 'right-',
    'border-l', 'border-r', 'rounded-l', 'rounded-r',
    'text-right', 'text-left',
  ];
  let d = 0;
  for (const t of tokens) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ca = (a.match(new RegExp('\\b' + escaped, 'g')) ?? []).length;
    const cb = (b.match(new RegExp('\\b' + escaped, 'g')) ?? []).length;
    if (ca > cb) d += ca - cb;
  }
  return d;
}

function main() {
  const files = listFiles(SRC_ROOT);
  let changed = 0;
  let totalSubs = 0;
  for (const f of files) {
    const before = readFileSync(f, 'utf8');
    const after = rewriteSource(before);
    if (after !== before) {
      const subs = approxDelta(before, after);
      totalSubs += subs;
      changed++;
      if (!DRY_RUN) writeFileSync(f, after, 'utf8');
      console.log(
        `${DRY_RUN ? '[dry] ' : ''}${relative(REPO_ROOT, f)}  (~${subs} subs)`,
      );
    }
  }
  console.log(
    `\n${DRY_RUN ? '[dry] ' : ''}Rewrote ${changed} file(s), ~${totalSubs} substitution(s).`,
  );
}

main();

/**
 * silentSuccessRatchet.guard.test.ts — audit systemic theme #17 (false success).
 *
 * A `catch { return [] }` (a catch that swallows the error and hands back an
 * EMPTY ARRAY) is the canonical "silent success" bug: an upstream API/DB failure
 * is reported to the rest of the pipeline as "fetched fine, just no rows". In a
 * fetcher or worker step that empty array flows straight into an UPSERT/aggregate
 * and zeroes-out real data (the #17 class — e.g. the metaStatus / metaHotMetrics
 * incident that D1 fixed). The honest contract is THROW (so the step's freshness
 * row records the failure + the orchestrator retries) — never a fake-empty
 * success.
 *
 * This guard scans the two highest-risk source trees — `src/lib/fetchers/**`
 * (external API/DB readers) and `src/inngest/functions/**` (cron + worker steps)
 * — and bans the pattern. It currently passes with ZERO matches; D1 already
 * removed the known offenders. It is a RATCHET: it does NOT clean up the past
 * (there is nothing to clean), it stops the pattern from being re-introduced.
 *
 * Pure node fs reads (mirrors gatewayTokenGuard / designColorGuard) — no DOM, no
 * network. Tests/fixtures are excluded so a deliberately-faked fetcher in a unit
 * test never trips the ratchet.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..'); // → dashboard-web/src

const SCAN_DIRS = ['lib/fetchers', 'inngest/functions'] as const;

// A catch clause (optionally binding an error) whose body's first statement
// swallows the failure into an empty array:  catch { return [] }
//   catch { return [] }
//   catch (e) { return []; }
//   catch (err) {\n  return [];\n}
// `[\s\S]` so it spans newlines; `\s*` after `{` so leading whitespace/newlines
// before the `return` are tolerated. We anchor on the FIRST statement being the
// bare return — a catch that logs/rethrows THEN returns elsewhere is not matched.
const SILENT_EMPTY = /catch\s*(\([^)]*\))?\s*\{\s*return\s*\[\s*\]\s*;?\s*\}/;

/** Recursively collect *.ts / *.tsx source files, skipping test + fixture dirs. */
function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === '__fixtures__' || entry === 'node_modules') continue;
      out.push(...collectSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe('silent-success ratchet — no `catch { return [] }` in fetchers / worker steps (#17)', () => {
  for (const rel of SCAN_DIRS) {
    const dir = join(SRC, rel);
    const files = collectSources(dir);

    it(`${rel}/** has source files to scan`, () => {
      // Sanity: if this ever hits 0, the scan silently passes for the wrong
      // reason (moved/renamed dir). Fail loud instead.
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      const shortRel = file.slice(SRC.length + 1);
      it(`${shortRel} never swallows a failure into an empty array`, () => {
        const text = readFileSync(file, 'utf8');
        const hit = SILENT_EMPTY.exec(text);
        expect(
          hit,
          `${shortRel} contains a silent-success "catch { return [] }" — an ` +
            `upstream failure is being reported as an empty (fake) success, which ` +
            `zeroes real data downstream. THROW so the freshness row records the ` +
            `failure and the orchestrator retries. Match:\n  ${hit?.[0]?.replace(/\s+/g, ' ').trim()}`,
        ).toBeNull();
      });
    }
  }
});

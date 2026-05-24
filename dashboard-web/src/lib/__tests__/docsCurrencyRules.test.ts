// dashboard-web/src/lib/__tests__/docsCurrencyRules.test.ts
//
// Phase 13.3 — unit tests for the docs-currency pre-push gate. Locks the
// two rules: UX-file changes require User Manual, architecture changes
// require ARCHITECTURE.md. Pure function tested in isolation; the CLI
// wrapper (scripts/docs-currency.mjs) just reads git diff and shells in.

import { describe, expect, it } from 'vitest';

// The pure function lives outside src/, so the import path traverses up.
// Resolved at runtime by Node's ESM resolver — no bundler-specific magic.
import { checkDocsCurrency } from '../../../../scripts/lib/docs-currency-rules.mjs';

describe('checkDocsCurrency (Phase 13.3 — pre-push docs gate)', () => {
  it('UX file with User Manual updated → ok', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/components/CampaignDrawer.tsx',
      'docs/ROAS-Dashboard-User-Manual.md',
    ]);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('UX file without User Manual update → fail with UX violation', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/components/CampaignDrawer.tsx',
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/User Manual/i);
    expect(r.violations.join(' ')).toMatch(/CampaignDrawer\.tsx/);
  });

  it('Inngest change with ARCHITECTURE.md updated → ok', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/inngest/functions/cronDaily.ts',
      'docs/ARCHITECTURE.md',
    ]);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('Inngest change without ARCHITECTURE.md → fail with Arch violation', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/inngest/functions/cronDaily.ts',
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/ARCHITECTURE\.md/);
    expect(r.violations.join(' ')).toMatch(/cronDaily\.ts/);
  });

  it('Test file under components/__tests__ is excluded from UX rule', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/components/__tests__/freshnessChip.test.ts',
    ]);
    expect(r.ok).toBe(true);
  });

  it('Pure lib utility (not a tripwire path) is not gated', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/lib/format.ts',
    ]);
    expect(r.ok).toBe(true);
  });

  it('Empty diff → ok', () => {
    const r = checkDocsCurrency([]);
    expect(r.ok).toBe(true);
  });

  it('Supabase migration without ARCHITECTURE.md → fail', () => {
    const r = checkDocsCurrency([
      'supabase/migrations/20260601000000_add_foo.sql',
    ]);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/ARCHITECTURE\.md/);
  });

  it('Fetcher change with ARCHITECTURE.md updated → ok', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/lib/fetchers/meta.ts',
      'docs/ARCHITECTURE.md',
    ]);
    expect(r.ok).toBe(true);
  });

  it('postgresReaders.ts without ARCHITECTURE.md → fail', () => {
    const r = checkDocsCurrency([
      'dashboard-web/src/lib/postgresReaders.ts',
    ]);
    expect(r.ok).toBe(false);
  });
});

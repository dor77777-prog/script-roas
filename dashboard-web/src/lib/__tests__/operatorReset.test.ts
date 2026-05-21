import { describe, it, expect } from 'vitest';
import {
  DATA_TABLES,
  EXCEPT_MANUAL_TABLES,
  PROTECTED_TABLES,
  CONFIRM_TOKEN_ALL,
  CONFIRM_TOKEN_EXCEPT_MANUAL,
  CONFIRM_TOKEN_FOR_SCOPE,
  validateResetBody,
} from '../operatorReset';

describe('operatorReset — table lists', () => {
  // The single most important invariant of this feature: the data-
  // table list and the protected-table list cannot overlap. A
  // typo (e.g. adding 'stores' to DATA_TABLES) would let the
  // operator wipe seeded config. The test asserts the disjointness
  // explicitly so a future edit cannot quietly break it.
  it('PROTECTED_TABLES are disjoint from DATA_TABLES', () => {
    const data = new Set<string>(DATA_TABLES);
    for (const protectedTable of PROTECTED_TABLES) {
      expect(data.has(protectedTable)).toBe(false);
    }
  });

  it('EXCEPT_MANUAL_TABLES is DATA_TABLES minus manual_overrides', () => {
    const dataSet = new Set<string>(DATA_TABLES);
    const exceptSet = new Set<string>(EXCEPT_MANUAL_TABLES);
    expect(exceptSet.has('manual_overrides')).toBe(false);
    // Every except-manual table must also be in data (no rogue tables).
    for (const t of EXCEPT_MANUAL_TABLES) {
      expect(dataSet.has(t)).toBe(true);
    }
    // The only difference between the two lists is manual_overrides.
    expect(DATA_TABLES.length - EXCEPT_MANUAL_TABLES.length).toBe(1);
  });

  it('PROTECTED_TABLES includes the three irreplaceable tables', () => {
    // Sanity guard — if a future refactor renames one of these without
    // updating PROTECTED_TABLES, this test catches it.
    const expected = ['stores', 'notification_config', 'dashboard_state'];
    for (const t of expected) {
      expect((PROTECTED_TABLES as readonly string[]).includes(t)).toBe(true);
    }
  });
});

describe('operatorReset — confirm tokens', () => {
  it('per-scope token map matches the exported literals', () => {
    expect(CONFIRM_TOKEN_FOR_SCOPE.all).toBe(CONFIRM_TOKEN_ALL);
    expect(CONFIRM_TOKEN_FOR_SCOPE['except-manual']).toBe(
      CONFIRM_TOKEN_EXCEPT_MANUAL,
    );
  });

  it('the two tokens are distinct strings', () => {
    // Distinct tokens mean a user who mis-clicks the wrong button
    // cannot accidentally complete the other scope by typing the
    // wrong literal — the comparison fails and the request is rejected.
    expect(CONFIRM_TOKEN_ALL).not.toBe(CONFIRM_TOKEN_EXCEPT_MANUAL);
  });

  it('token strings encode the scope they unlock', () => {
    // Defensive — a token like 'YES' would let either scope go through.
    // Asserting both tokens mention their scope keeps the literal
    // self-describing to a future reader.
    expect(CONFIRM_TOKEN_ALL).toContain('ALL');
    expect(CONFIRM_TOKEN_EXCEPT_MANUAL).toContain('EXCEPT-MANUAL');
  });
});

describe('validateResetBody', () => {
  it('rejects non-object body', () => {
    expect(typeof validateResetBody(null)).toBe('string');
    expect(typeof validateResetBody(undefined)).toBe('string');
    expect(typeof validateResetBody('hello')).toBe('string');
    expect(typeof validateResetBody(42)).toBe('string');
  });

  it('rejects unknown scope', () => {
    const result = validateResetBody({ scope: 'partial', confirm: 'X' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/scope/);
  });

  it("rejects when scope='all' has wrong confirm token", () => {
    const result = validateResetBody({ scope: 'all', confirm: 'YES' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/confirm/);
  });

  it("rejects when scope='except-manual' has the wrong confirm token", () => {
    // Cross-scope token: shouldn't unlock except-manual just because
    // it's a valid literal for another scope.
    const result = validateResetBody({
      scope: 'except-manual',
      confirm: CONFIRM_TOKEN_ALL,
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/confirm/);
  });

  it('rejects missing confirm field entirely', () => {
    const result = validateResetBody({ scope: 'all' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/confirm/);
  });

  it("accepts scope='all' with the correct token", () => {
    const result = validateResetBody({
      scope: 'all',
      confirm: CONFIRM_TOKEN_ALL,
    });
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.scope).toBe('all');
      expect(result.confirm).toBe(CONFIRM_TOKEN_ALL);
    }
  });

  it("accepts scope='except-manual' with the correct token", () => {
    const result = validateResetBody({
      scope: 'except-manual',
      confirm: CONFIRM_TOKEN_EXCEPT_MANUAL,
    });
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.scope).toBe('except-manual');
      expect(result.confirm).toBe(CONFIRM_TOKEN_EXCEPT_MANUAL);
    }
  });

  it('rejects confirm field of wrong type (non-string)', () => {
    const result = validateResetBody({ scope: 'all', confirm: 42 });
    expect(typeof result).toBe('string');
  });

  it('error messages do NOT echo the required token (avoid token leak)', () => {
    // If the error told the operator the expected literal, the typed-
    // friction defense would collapse. Verify the rejection message
    // doesn't include the secret.
    const result = validateResetBody({ scope: 'all', confirm: 'wrong' });
    expect(typeof result).toBe('string');
    if (typeof result === 'string') {
      expect(result).not.toContain(CONFIRM_TOKEN_ALL);
      expect(result).not.toContain(CONFIRM_TOKEN_EXCEPT_MANUAL);
    }
  });
});

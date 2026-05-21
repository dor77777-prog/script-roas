import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFrom } from '../featureFlags';

describe('readFrom feature flag (D-E2)', () => {
  const originalEnv = process.env.READ_FROM;

  beforeEach(() => {
    delete process.env.READ_FROM;
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env.READ_FROM = originalEnv;
    else delete process.env.READ_FROM;
  });

  it('defaults to sheets when env var missing', () => {
    expect(readFrom()).toBe('sheets');
  });

  it("returns 'sheets' explicit", () => {
    process.env.READ_FROM = 'sheets';
    expect(readFrom()).toBe('sheets');
  });

  it("returns 'postgres' explicit", () => {
    process.env.READ_FROM = 'postgres';
    expect(readFrom()).toBe('postgres');
  });

  it("falls back to 'sheets' for unknown values", () => {
    process.env.READ_FROM = 'Invalid';
    expect(readFrom()).toBe('sheets');
    process.env.READ_FROM = 'POSTGRES'; // case-sensitive
    expect(readFrom()).toBe('sheets');
  });

  it('reads env at each call (not cached)', () => {
    process.env.READ_FROM = 'sheets';
    expect(readFrom()).toBe('sheets');
    process.env.READ_FROM = 'postgres';
    expect(readFrom()).toBe('postgres'); // immediately reflects the change
    delete process.env.READ_FROM;
    expect(readFrom()).toBe('sheets');
  });
});

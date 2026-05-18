import { describe, it, expect } from 'vitest';
import { safeDecode } from '@/lib/utils';

describe('safeDecode', () => {
  it('decodes a valid URL-encoded string', () => {
    expect(safeDecode('Summer%20Sale')).toBe('Summer Sale');
  });

  it('returns the raw input unchanged when the string has an invalid % sequence', () => {
    // '100%' has a lone % at end — decodeURIComponent throws URIError
    expect(safeDecode('100%')).toBe('100%');
  });

  it('returns empty string for empty string input', () => {
    expect(safeDecode('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(safeDecode(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(safeDecode(undefined)).toBe('');
  });

  it('returns the string unchanged when there are no percent-encoded characters', () => {
    expect(safeDecode('Summer Sale')).toBe('Summer Sale');
  });

  it('correctly decodes Hebrew UTF-8 multi-byte encoded string', () => {
    // %D7%A7%D7%99%D7%A5 = 'קיץ' in UTF-8
    expect(safeDecode('%D7%A7%D7%99%D7%A5')).toBe('קיץ');
  });

  it('returns the raw input for malformed mid-string encoding (foo%E0bar)', () => {
    // %E0 is an incomplete 2-byte UTF-8 sequence → URIError → return as-is
    expect(safeDecode('foo%E0bar')).toBe('foo%E0bar');
  });
});

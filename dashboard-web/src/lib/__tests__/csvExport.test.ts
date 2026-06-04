import { describe, it, expect } from 'vitest';
import { toCsv } from '@/lib/csvExport';

describe('toCsv', () => {
  it('serializes headers + rows with numbers', () => {
    const csv = toCsv(['name', 'spend', 'roas'], [['Winter', 1240, 3.4], ['Spring', 0, 0]]);
    expect(csv).toBe('name,spend,roas\nWinter,1240,3.4\nSpring,0,0');
  });

  it('quotes + escapes fields with commas, quotes, and newlines', () => {
    const csv = toCsv(['name', 'note'], [
      ['Sale, Big', 'he said "hi"'],
      ['Multi\nline', 'plain'],
    ]);
    expect(csv).toBe('name,note\n"Sale, Big","he said ""hi"""\n"Multi\nline",plain');
  });

  it('renders null/undefined cells as empty strings', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, 'x']])).toBe('a,b,c\n,,x');
  });
});

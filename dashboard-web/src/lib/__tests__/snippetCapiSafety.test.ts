import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateStoreSnippet } from '@/lib/storeSnippets';

const FORBIDDEN = /\bfbq\s*\(|\bgtag\s*\(|\bttq\s*\(|analytics\.track|dataLayer\.push|\/capi\/|conversions_api/i;
const themed = generateStoreSnippet({ storeId: 's', cartPublicToken: 't', allowedOrigins: [], isHeadless: false });
const headless = generateStoreSnippet({ storeId: 's', cartPublicToken: 't', allowedOrigins: [], isHeadless: true });
const blobs = [themed, headless].flatMap(r => [r.primary, r.secondary, r.note].filter(Boolean) as string[]);
const doc = readFileSync(join(process.cwd(), '..', 'docs', 'storefront-snippets', 'first-touch-attribution.md'), 'utf8');

describe('snippets are CAPI-safe (reporting-only) + carry _ft_* (new-store parity)', () => {
  it('no pixel/CAPI calls in any generated snippet', () => {
    for (const b of blobs) expect(FORBIDDEN.test(b)).toBe(false);
  });
  it('no pixel/CAPI calls in the source-of-truth doc', () => {
    expect(FORBIDDEN.test(doc)).toBe(false);
  });
  it('every generated snippet writes _ft_* cart attributes', () => {
    expect(blobs.join('\n')).toContain('_ft_utm_id');
  });
});

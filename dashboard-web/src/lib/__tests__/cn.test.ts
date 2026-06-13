import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

/**
 * Regression coverage for the `cn()` / tailwind-merge font-size bug (2026-06-13).
 *
 * `cn` is `twMerge(clsx(...))`. The Horizon type-ramp (`text-fs-2xs` … `text-fs-2xl`,
 * wired in tailwind.config.ts under `fontSize`) are FONT-SIZE utilities. Stock
 * tailwind-merge doesn't know the `fs-*` token, so it mis-grouped `text-fs-*` as a
 * text-COLOR and silently DROPPED the real colour when both appeared — e.g.
 * `<Button variant="primary" className="… text-fs-2xs">` lost `text-accent-fg` and
 * rendered navy ink on the accent button. The fix registers the whole ramp in the
 * `font-size` group via extendTailwindMerge, so `text-fs-*` now:
 *   • NEVER conflicts with a text colour (both survive), and
 *   • conflicts with other font sizes (`text-xs`, another `text-fs-*`) → last wins.
 *
 * These assertions use the REAL `cn` and split the output on whitespace so a
 * substring like `text-fs-2xs` can't accidentally match inside `text-fs-2xl`.
 */
function classes(out: string): string[] {
  return out.split(/\s+/).filter(Boolean);
}

describe('cn() — text-fs-* registered as font-size (not text-color)', () => {
  it('keeps BOTH a text colour and a ramp size (the bug: colour was dropped)', () => {
    const out = classes(cn('text-accent-fg', 'text-fs-2xs'));
    expect(out).toContain('text-accent-fg');
    expect(out).toContain('text-fs-2xs');
  });

  it('keeps BOTH a muted-ink colour and a ramp size (reverse pairing)', () => {
    const out = classes(cn('text-fs-2xs', 'text-ink-muted'));
    expect(out).toContain('text-fs-2xs');
    expect(out).toContain('text-ink-muted');
  });

  it('a ramp size WINS over a legacy bare size — same font-size group', () => {
    const out = classes(cn('text-xs', 'text-fs-2xs'));
    expect(out).toContain('text-fs-2xs');
    expect(out).not.toContain('text-xs');
  });

  it('two ramp sizes collapse to the last one (last-write-wins within the group)', () => {
    const out = classes(cn('text-fs-sm', 'text-fs-2xs'));
    expect(out).toContain('text-fs-2xs');
    expect(out).not.toContain('text-fs-sm');
  });

  it('text-fs-md is also registered (full ramp) — wins over a legacy size', () => {
    // fs-md is used in CustomerValueTab; it must merge like the rest of the ramp.
    const out = classes(cn('text-base', 'text-fs-md'));
    expect(out).toContain('text-fs-md');
    expect(out).not.toContain('text-base');
  });

  it('the real accent-button case: colour is preserved alongside a ramp size', () => {
    const out = classes(
      cn('bg-accent-btn text-accent-fg text-xs', 'text-fs-2xs font-bold'),
    );
    // The load-bearing assertion: the colour survives the merge.
    expect(out).toContain('text-accent-fg');
    // The ramp size wins over the legacy bare size; both decorations survive.
    expect(out).toContain('text-fs-2xs');
    expect(out).not.toContain('text-xs');
    expect(out).toContain('bg-accent-btn');
    expect(out).toContain('font-bold');
  });
});

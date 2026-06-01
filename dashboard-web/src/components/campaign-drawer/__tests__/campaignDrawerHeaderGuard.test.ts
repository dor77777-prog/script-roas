// dashboard-web/src/components/campaign-drawer/__tests__/campaignDrawerHeaderGuard.test.ts
//
// Task 1.5 — campaign-drawer NEUTRAL header regression guard.
//
// Two failure modes this test locks down:
//
//   1. THE BUG (header was invisible on every campaign): the header
//      <SheetHeader data-testid="campaign-drawer-hero"> previously carried
//      className="glass" + data-band={heroBand}. The globals.css rule
//      `.glass[data-band]:not([data-mounted]) { opacity: 0 }` hides every
//      banded .glass element until JS adds data-mounted — but SheetHeader
//      never adds it, so the whole header stayed at opacity:0 (name/store/
//      platform present in the DOM but transparent). The neutral header has
//      NO data-band, so that rule can no longer match it. We assert the
//      header attributes contain neither `data-band` nor `className="glass"`.
//
//   2. THE FEATURE: the neutral header shows identity via a brand-colored
//      platform pill (`.platform-pill` wrapping the canonical <PlatformBadge>)
//      instead of the old megaphone-icon + plain-text meta row. We assert
//      both markers are present.
//
// This is a source-file guard (fs.readFileSync + regex slice) rather than a
// DOM mount — same rationale as goalTrackerPlacement.test.ts: the
// CampaignDrawer root self-fetches via SWR and only renders the header when
// `open && summary`, so mounting it in jsdom would require heavy SWR + rows
// fixtures for a test whose whole point is asserting an attribute's ABSENCE.
// Slicing the header JSX block is cheap, hermetic, and robust to surrounding
// refactors as long as the `data-testid="campaign-drawer-hero"` anchor stays.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DRAWER_SRC = resolve(__dirname, '..', 'index.tsx');

/** Slice the <SheetHeader …> opening tag (attributes only) up to its first `>`. */
function sliceHeaderOpenTag(source: string): string {
  const start = source.indexOf('<SheetHeader');
  if (start === -1) throw new Error('<SheetHeader …> not found in campaign-drawer/index.tsx');
  const end = source.indexOf('>', start);
  if (end === -1) throw new Error('<SheetHeader …> opening tag never closed');
  return source.slice(start, end + 1);
}

/** Slice the full <SheetHeader>…</SheetHeader> element (children included). */
function sliceHeaderElement(source: string): string {
  const start = source.indexOf('<SheetHeader');
  const end = source.indexOf('</SheetHeader>', start);
  if (start === -1 || end === -1) throw new Error('<SheetHeader>…</SheetHeader> not found');
  return source.slice(start, end);
}

describe('CampaignDrawer neutral header (Task 1.5)', () => {
  const src = readFileSync(DRAWER_SRC, 'utf8');

  it('marks the header with data-testid="campaign-drawer-hero"', () => {
    const openTag = sliceHeaderOpenTag(src);
    expect(openTag).toMatch(/data-testid="campaign-drawer-hero"/);
  });

  it('does NOT put data-band on the header (so the opacity:0 rule can never hide it)', () => {
    const openTag = sliceHeaderOpenTag(src);
    expect(
      openTag,
      'data-band on <SheetHeader> re-triggers the .glass[data-band]:not([data-mounted]) opacity:0 bug — the header must stay neutral',
    ).not.toMatch(/data-band/);
  });

  it('does NOT give the header className="glass" (neutral surface from the SheetHeader primitive)', () => {
    const openTag = sliceHeaderOpenTag(src);
    expect(
      openTag,
      'className="glass" on <SheetHeader> reintroduces the banded-glass opacity:0 coupling',
    ).not.toMatch(/className="glass"/);
  });

  it('renders the brand-colored platform pill (.platform-pill + <PlatformBadge>)', () => {
    const header = sliceHeaderElement(src);
    expect(header, 'header must use the .platform-pill brand-tint wrapper').toMatch(/className="platform-pill"/);
    expect(header, 'header must render the canonical <PlatformBadge> for platform identity').toMatch(/<PlatformBadge\b/);
  });

  it('drops the old Megaphone identity icon (replaced by the platform pill)', () => {
    const header = sliceHeaderElement(src);
    expect(header, 'the Megaphone icon is redundant once the platform pill is the identity element').not.toMatch(/<Megaphone\b/);
  });
});

// The platform pill's brand-tinted background fails WCAG-AA if the LABEL keeps
// the brand hue (same-hue-on-same-hue — e.g. Google amber ~1.75:1 in light).
// globals.css must re-point the pill's `.platform-name` to the neutral `--text`
// ink (the dot keeps brand colour). Guard the rule so the AA fix can't regress.
describe('CampaignDrawer platform-pill label contrast (Task 1.5 — AA)', () => {
  const css = readFileSync(resolve(__dirname, '..', '..', '..', 'app', 'globals.css'), 'utf8');

  it('forces the pill LABEL to the neutral --text ink (never the brand hue)', () => {
    expect(
      css,
      '.platform-pill .platform-name must be re-pointed to var(--text) so the brand-hue label never sits on its own faint tint (WCAG-AA)',
    ).toMatch(/\.platform-pill\s+\.platform-name\s*\{[^}]*color:\s*var\(--text\)\s*!important/);
  });
});

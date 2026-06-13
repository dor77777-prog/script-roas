/**
 * Gateway-token GREP-BAN guard (reskin W5.1, design-debt #9).
 *
 * The תשלומים (Payments) tab splits sales by payment GATEWAY (credit / PayPal /
 * other). PayPal used to paint the LOCKED Meta brand token — `bg-chart-meta` /
 * `text-chart-meta` (= `--chart-platform-meta` #1877f2). PayPal and Meta are
 * different entities that merely share a blue hue, so retuning the Meta platform
 * colour would have SILENTLY recoloured PayPal (debt #9). W5.1 gave payment
 * gateways their OWN palette (`--gateway-*`) and repointed every call-site.
 *
 * This guard makes the fix HERMETIC:
 *   1. No payments file may reference the `chart-meta` utility ever again
 *      (`bg-chart-meta` / `text-chart-meta` / …). A pure substring ban — the
 *      CSS-var name `--chart-platform-meta` does NOT contain "chart-meta", so a
 *      legitimate historical mention of the platform var in a comment is fine.
 *   2. The `--gateway-*` tokens must be declared in BOTH theme blocks of
 *      globals.css (:root = dark, [data-theme="light"] = light) so the palette
 *      re-skins per theme (the broad themeParity guard covers parity too; this
 *      pins the specific token names so neither block can quietly drop one).
 *   3. PaymentMethodsTab must actually CONSUME the gateway tokens (positive
 *      assertion that the migration happened, not just that the old token left).
 *
 * Pure node fs reads (like designColorGuard / contrastGuard) — no DOM.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

// Payments files whose gateway colours must never borrow the Meta brand token.
const PAYMENTS_FILES = ['components/PaymentMethodsTab.tsx'];

// The banned utility substring. Assembled at runtime so THIS test file never
// itself contains the literal forbidden class (it lives outside the scanned
// set anyway, but keeps intent copy-paste-safe).
const BANNED = ['chart', 'meta'].join('-'); // → "chart-meta"

describe('gateway-token guard — payments files never borrow the Meta brand token (debt #9)', () => {
  for (const rel of PAYMENTS_FILES) {
    it(`${rel} contains zero "${BANNED}" references`, () => {
      const text = readFileSync(join(SRC, rel), 'utf8');
      const hits = text
        .split(/\r?\n/)
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter((l) => l.text.includes(BANNED));
      expect(
        hits,
        `${rel} still references "${BANNED}" — PayPal must use the dedicated ` +
          `--gateway-paypal token, never the locked --chart-platform-meta brand ` +
          `blue:\n  ${hits.map((h) => `${h.line}: ${h.text.trim()}`).join('\n  ')}`,
      ).toHaveLength(0);
    });
  }
});

describe('gateway-token guard — --gateway-* tokens are declared in BOTH theme blocks', () => {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');

  function block(selector: 'root' | 'light'): string {
    const re =
      selector === 'root'
        ? /:root\s*\{([\s\S]*?)\n\}/
        : /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/;
    const m = css.match(re);
    if (!m) throw new Error(`${selector} block not found in globals.css`);
    return m[1];
  }

  const REQUIRED = [
    '--gateway-credit',
    '--gateway-credit-ink',
    '--gateway-paypal',
    '--gateway-paypal-ink',
    '--gateway-other',
  ] as const;

  for (const theme of [
    { name: 'dark', blk: block('root') },
    { name: 'light', blk: block('light') },
  ] as const) {
    for (const tok of REQUIRED) {
      it(`${theme.name}: ${tok} is declared`, () => {
        const declared = new RegExp(`(?<![\\w-])${tok}\\s*:`).test(theme.blk);
        expect(declared, `${tok} missing from the ${theme.name} block`).toBe(true);
      });
    }
  }
});

describe('gateway-token guard — PaymentMethodsTab consumes the gateway palette', () => {
  const text = readFileSync(join(SRC, 'components', 'PaymentMethodsTab.tsx'), 'utf8');
  for (const cls of [
    'bg-gateway-credit',
    'bg-gateway-paypal',
    'bg-gateway-other',
    'text-gateway-paypalInk',
  ]) {
    it(`uses ${cls}`, () => {
      expect(text.includes(cls), `${cls} not found in PaymentMethodsTab.tsx`).toBe(true);
    });
  }
});

import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The Horizon type-ramp utilities (`text-fs-2xs` … `text-fs-2xl`, declared under
// tailwind `fontSize`) are FONT-SIZE classes. Stock tailwind-merge doesn't know the
// `fs-*` token, so it mis-grouped `text-fs-*` as a text-COLOR and silently dropped a
// real colour: e.g. `<Button variant="primary" className="… text-fs-2xs">` lost its
// `text-accent-fg`, rendering navy ink on the accent button (and, in the reverse
// order, a colour could drop the size). Registering `text-fs-*` in the `font-size`
// group makes them conflict with each other / `text-xs` but NEVER with a text colour.
//
// The list MUST mirror the full `fontSize` ramp in tailwind.config.ts — including
// `fs-md` (used in CustomerValueTab as `text-fs-base sm:text-fs-md`). Any omitted
// size stays mis-grouped as a colour and re-introduces the dropped-colour bug for
// that one size, so keep this in sync with the config's `fontSize` keys.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'fs-2xs',
            'fs-xs',
            'fs-sm',
            'fs-base',
            'fs-md',
            'fs-lg',
            'fs-xl',
            'fs-2xl',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(n: number, fractionDigits = 0): string {
  // Previously this passed `Math.round(n)` to Intl.NumberFormat, which threw
  // away the fractional part BEFORE the formatter ran — so `formatCurrency(5.40, 2)`
  // showed "5.00" instead of "5.40". That silently broke every CPC / CPM / CPA
  // cell in the table for ~ever. Let Intl.NumberFormat do the rounding to the
  // requested precision — it handles both fractionDigits=0 (→ integer) and
  // fractionDigits=2 (→ 2 decimals) correctly via maximumFractionDigits.
  //
  // Audit fix 2026-05-23 (FIND-07 dashboard-fidelity): avoid the "-0" /
  // "-0.00" output that Intl.NumberFormat produces when a tiny negative
  // input rounds to zero magnitude at the requested precision. Pre-
  // normalize so the operator never sees a "-0" cell that looks like a
  // rendering glitch but is actually the rounded form of e.g. -0.4 CAD.
  const factor = Math.pow(10, fractionDigits);
  const rounded = Math.round(n * factor) / factor;
  const normalized = rounded === 0 ? 0 : n;
  return new Intl.NumberFormat('he-IL', {
    style: 'decimal',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(normalized);
}

export function formatNumber(n: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('he-IL', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function formatDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  const [y, m, d] = yyyymmdd.split('-');
  return `${d}/${m}/${y}`;
}

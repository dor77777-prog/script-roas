import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Heebo, Rubik, Geist_Mono } from 'next/font/google';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/Tooltip';

// Heebo is the de-facto Hebrew sans-serif for product UIs: clean, readable,
// supports the full set of weights we use (300 for big numbers, 600 for
// headings). Loaded via next/font so it self-hosts and avoids FOIT.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
});

const rubik = Rubik({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  // Rubik has real OpenType `tnum` + `zero` + `case` features that Heebo
  // lacks. Adding it as the numeric font fixes a silent bug where the
  // existing `.tabular-nums` class declared the feature against Heebo
  // (which has no tnum), making columns align only because Heebo's
  // digits are coincidentally near-monowidth.
  variable: '--font-rubik',
  display: 'swap',
});

const geistMono = Geist_Mono({
  // Geist Mono is on Google Fonts (added in 2024). next/font/google
  // handles subset loading, hashing, and CSS variable wiring just like
  // Heebo and Rubik above. No manual woff2 vendoring needed.
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'דשבורד ROAS',
  description: 'מעקב הוצאות ↔ הכנסות יומי לכל החנויות',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Dual-mode browser-chrome tint: dark matches --canvas-1 (deep blue-violet);
  // light (#f3f4f8) is provisional light-canvas chrome — will be reconciled
  // with the real light canvas token in a later phase.
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#0a0c1d' },
    { media: '(prefers-color-scheme: light)', color: '#f3f4f8' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-theme is NOT hard-coded here. The inline script below sets it before
  // first paint (eliminating FOUC) by reading localStorage + OS preference,
  // matching the resolveTheme() logic in ThemeProvider. suppressHydrationWarning
  // on <html> is required because the pre-paint script mutates data-theme
  // before React hydrates (standard next-themes pattern — React ignores the
  // mismatch rather than emitting a hydration-warning).
  return (
    <html
      lang="he"
      dir="rtl"
      suppressHydrationWarning
      className={`${heebo.variable} ${rubik.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased text-ink bg-canvas">
        {/* Pre-hydration theme bootstrap — first child of <body> so it runs before
            first paint and prevents FOUC (render-blocking inline scripts at the top
            of <body> execute before any rendering, matching the next-themes pattern).
            Key 'roas-theme' matches THEME_STORAGE_KEY in lib/theme.ts.
            Semantics: explicit light/dark wins; else follow OS; default dark on error.
            suppressHydrationWarning stays on <html> because the script mutates
            document.documentElement (data-theme) before React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var c=localStorage.getItem('roas-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(c==='light'||c==='dark')?c:(d?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();` }} />
        <ThemeProvider>
          {/*
            Tooltip-system-redesign · Task 1.3 — single Radix Tooltip root for
            the whole app. delayDuration=200ms opens a touch faster than the
            old 300ms (snappier on hover without firing on transient passes);
            skipDelayDuration=300ms keeps the "already-open" grace window long
            enough that moving between adjacent help chips in dense table UIs
            (CampaignsTableRow, AdsDrawer) chains instantly without re-waiting.
          */}
          <TooltipProvider delayDuration={200} skipDelayDuration={300}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

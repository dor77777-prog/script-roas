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
  // Matches --canvas-1 (deep blue-violet single-mode dark canvas).
  themeColor: '#0a0c1d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Single-mode dark per the 2026-05-31 visual-direction flip. data-theme
  // is hard-coded on <html> so the first paint is correct and there is no
  // light-mode bootstrapping script to delete with hydration. ThemeProvider
  // is retained for its useTheme() consumers (Sidebar, CommandPalette) but
  // its DOM-write effect always resolves to "dark" now.
  return (
    <html
      lang="he"
      dir="rtl"
      data-theme="dark"
      className={`${heebo.variable} ${rubik.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased text-ink bg-canvas">
        <ThemeProvider>
          {/*
            Task 2.6 — single Radix Tooltip root for the whole app.
            delayDuration=300ms balances "show on hover" with not being
            annoying; skipDelayDuration=150ms lets adjacent tooltips
            chain quickly once one is already open (matches Radix
            recommendation for dense table UIs like CampaignsTableRow
            and AdsDrawer).
          */}
          <TooltipProvider delayDuration={300} skipDelayDuration={150}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

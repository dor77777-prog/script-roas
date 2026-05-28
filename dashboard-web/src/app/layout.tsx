import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Heebo, Rubik, Geist_Mono } from 'next/font/google';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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
  themeColor: '#0d3680',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased text-text-primary bg-background">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}

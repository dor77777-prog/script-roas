import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Heebo } from 'next/font/google';

// Heebo is the de-facto Hebrew sans-serif for product UIs: clean, readable,
// supports the full set of weights we use (300 for big numbers, 600 for
// headings). Loaded via next/font so it self-hosts and avoids FOIT.
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-heebo',
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
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans antialiased text-text-primary bg-background">{children}</body>
    </html>
  );
}

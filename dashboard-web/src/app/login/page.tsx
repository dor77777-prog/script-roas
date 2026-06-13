// dashboard-web/src/app/login/page.tsx
//
// Password-gate login page. Reachable WITHOUT a cookie (allowlisted in the
// middleware). Minimal brand-matched glass card: ROAS logo mark + title, one
// password field, submit button, and an inline error line on a wrong password.
//
// Token-driven styling only (bg-canvas / glass / text-ink / bg-accent-btn /
// Heebo via the root layout) — no raw colors, light+dark + RTL inherited from
// <html dir="rtl">. The password is NEVER in client code: the user types it
// and it is POSTed to /api/login, which compares it to the server-only env var.
//
// useSearchParams() requires a Suspense boundary in the Next 15 App Router, so
// the interactive form lives in LoginForm and is wrapped here.

import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata = {
  title: 'כניסה — דשבורד ROAS',
};

export default function LoginPage() {
  return (
    // Horizon auth backdrop: the flat `bg-canvas` (Horizon light primary in
    // light, navy canvas in dark — both via the --canvas-1 token) plus a single
    // token-driven radial wash centred behind the card. The radial reuses the
    // SAME `--bg-glow` token the global body backdrop uses (subtle violet on
    // dark / subtle teal on light), so the auth screen reads as part of the
    // app's surface system rather than a flat slab — no raw colours, no
    // contrast cost (the card sits on its own opaque surface above the glow).
    <main className="relative min-h-screen bg-canvas flex items-center justify-center px-4 py-10 bg-[radial-gradient(900px_500px_at_50%_38%,var(--bg-glow),transparent_60%)]">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

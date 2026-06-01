'use client';

// dashboard-web/src/app/login/LoginForm.tsx
//
// Client form for the password gate. Reads the `next` param, POSTs the typed
// password + next to /api/login, and on success redirects to the sanitized
// next path the server returns (falls back to '/'). On a wrong password it
// shows an inline error line. NO password constant lives here — it is only
// what the user types.
//
// Styling reuses the project primitives/tokens (Card glass surface, Button
// primary = bg-accent-btn, Input). Light+dark + RTL are inherited from the
// root <html dir="rtl">.

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, next }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { next?: string };
        // Hard navigation so the freshly-set cookie is sent on the next request
        // and the middleware lets us through.
        window.location.assign(typeof data.next === 'string' ? data.next : '/');
        return;
      }
      setError(true);
      setSubmitting(false);
    } catch {
      setError(true);
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <div className="flex flex-col items-center text-center gap-2 mb-6">
        {/* Brand mark — same violet gradient as the sidebar logo (both themes). */}
        <div
          className="h-11 w-11 rounded-xl bg-gradient-to-br from-[var(--sidebar-logo-1)] to-[var(--sidebar-logo-2)]"
          aria-hidden
        />
        <h1 className="text-lg font-semibold text-ink">דשבורד ROAS</h1>
        <p className="text-sm text-ink-muted">הזינו סיסמה כדי להמשיך</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <label htmlFor="dash-password" className="sr-only">
          סיסמה
        </label>
        <Input
          id="dash-password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          autoFocus
          placeholder="סיסמה"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(false);
          }}
          error={error}
          aria-invalid={error || undefined}
          aria-describedby={error ? 'dash-password-error' : undefined}
        />

        {error && (
          <p
            id="dash-password-error"
            role="alert"
            className="text-[13px] font-medium text-status-redFg text-center"
          >
            סיסמה שגויה. נסו שוב.
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={submitting || password.length === 0}>
          {submitting ? 'מתחבר…' : 'כניסה'}
        </Button>
      </form>
    </Card>
  );
}

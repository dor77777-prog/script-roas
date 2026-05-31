'use client';

// dashboard-web/src/components/operator/OperatorSecretBanner.tsx
//
// Security hardening FIX 3 — operator-secret entry UI.
//
// Renders a secret-entry form at the top of the /operator page:
//   - If no secret is stored in localStorage → shows an inline form with a
//     password input + "Save" button.
//   - If a secret IS stored → shows a subtle "Change/clear secret" affordance.
//
// The operator console continues to render below this banner regardless of
// whether a secret is set. If OPERATOR_SECRET is not configured on the server,
// the header is harmless and all API calls pass through. If it IS configured,
// API calls will 404 until the secret is stored here.
//
// The explanatory copy intentionally mentions both Hebrew and technical context
// (Vercel env var, localStorage) so an operator who hasn't read the docs can
// self-diagnose a 404 from the console.

import { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import {
  getOperatorSecret,
  setOperatorSecret,
} from '@/lib/operatorClient';
import { Button } from '@/components/ui/Button';

export function OperatorSecretBanner() {
  const [stored, setStored] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);

  // Read on mount — SSR-safe (getOperatorSecret returns null server-side)
  useEffect(() => {
    setStored(getOperatorSecret());
  }, []);

  const handleSave = () => {
    const trimmed = input.trim();
    setOperatorSecret(trimmed || null);
    setStored(trimmed || null);
    setInput('');
    setShowInput(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClear = () => {
    setOperatorSecret(null);
    setStored(null);
    setInput('');
    setShowInput(false);
  };

  // No secret stored → show the entry form
  if (!stored) {
    return (
      <div className="rounded border border-status-orange/30 bg-status-orangeBg p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-status-orange font-medium">
          <KeyRound className="w-4 h-4 shrink-0" />
          <span>הגדרת Operator Secret</span>
        </div>
        <p className="text-ink-secondary text-xs">
          נדרש כאשר <code className="text-status-orange">OPERATOR_SECRET</code> מוגדר
          ב-Vercel; נשמר ב-localStorage של הדפדפן הזה. כל קריאות ה-API ל-
          <code className="text-status-orange">/api/operator/*</code> יכלול את ה-secret
          אוטומטית.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <input
              type={showPassword ? 'text' : 'password'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="הזן את ה-secret…"
              className="w-full bg-canvas border border-glass-edge rounded px-2 py-1 text-sm text-ink pr-8 focus:border-accent focus:outline-none"
              dir="ltr"
              autoComplete="off"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 w-auto h-auto p-0 flex items-center text-ink-secondary hover:text-ink"
              aria-label={showPassword ? 'הסתר secret' : 'הצג secret'}
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={handleSave}
            disabled={!input.trim()}
            className="h-auto bg-status-orange hover:bg-status-orange/90 text-white text-sm px-3 py-1"
          >
            שמור
          </Button>
        </div>
      </div>
    );
  }

  // Secret IS stored → show a subtle affordance to change or clear it
  return (
    <div className="rounded border border-glass-edge bg-canvas px-3 py-2 flex items-center justify-between text-xs text-ink-secondary">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-status-green shrink-0" />
        <span>Operator secret מוגדר ב-localStorage.</span>
        {saved && (
          <span className="text-status-green font-medium">נשמר!</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showInput ? (
          <>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                placeholder="secret חדש…"
                className="bg-canvas border border-glass-edge rounded px-2 py-0.5 text-xs text-ink pr-7 focus:border-accent focus:outline-none"
                dir="ltr"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-1.5 w-auto h-auto p-0 flex items-center text-ink-secondary"
                aria-label={showPassword ? 'הסתר' : 'הצג'}
              >
                {showPassword ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
              </Button>
            </div>
            <Button
              type="button"
              variant="link"
              onClick={handleSave}
              disabled={!input.trim()}
              className="h-auto p-0 text-status-orange hover:text-status-orange/90"
            >
              שמור
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => { setShowInput(false); setInput(''); }}
              className="h-auto p-0 text-ink-secondary hover:text-ink"
            >
              ביטול
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="link"
              onClick={() => setShowInput(true)}
              className="h-auto p-0 text-status-orange hover:text-status-orange/90"
            >
              החלף secret
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={handleClear}
              className="h-auto p-0 text-status-red hover:text-status-red/90"
            >
              נקה
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

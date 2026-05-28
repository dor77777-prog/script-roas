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
      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 text-amber-300 font-medium">
          <KeyRound className="w-4 h-4 shrink-0" />
          <span>הגדרת Operator Secret</span>
        </div>
        <p className="text-text-secondary text-xs">
          נדרש כאשר <code className="text-amber-200">OPERATOR_SECRET</code> מוגדר
          ב-Vercel; נשמר ב-localStorage של הדפדפן הזה. כל קריאות ה-API ל-
          <code className="text-amber-200">/api/operator/*</code> יכלול את ה-secret
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
              className="w-full bg-black/30 border border-white/15 rounded px-2 py-1 text-sm text-foreground pr-8"
              dir="ltr"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 flex items-center text-text-secondary hover:text-foreground"
              aria-label={showPassword ? 'הסתר secret' : 'הצג secret'}
            >
              {showPassword ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!input.trim()}
            className="bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm px-3 py-1 rounded"
          >
            שמור
          </button>
        </div>
      </div>
    );
  }

  // Secret IS stored → show a subtle affordance to change or clear it
  return (
    <div className="rounded border border-white/10 bg-black/20 px-3 py-2 flex items-center justify-between text-xs text-text-secondary">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
        <span>Operator secret מוגדר ב-localStorage.</span>
        {saved && (
          <span className="text-green-400 font-medium">נשמר!</span>
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
                className="bg-black/30 border border-white/15 rounded px-2 py-0.5 text-xs text-foreground pr-7"
                dir="ltr"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-1.5 flex items-center text-text-secondary"
                aria-label={showPassword ? 'הסתר' : 'הצג'}
              >
                {showPassword ? (
                  <EyeOff className="w-3 h-3" />
                ) : (
                  <Eye className="w-3 h-3" />
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!input.trim()}
              className="text-amber-400 hover:text-amber-300 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              שמור
            </button>
            <button
              type="button"
              onClick={() => { setShowInput(false); setInput(''); }}
              className="text-text-secondary hover:text-foreground"
            >
              ביטול
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowInput(true)}
              className="text-amber-400 hover:text-amber-300"
            >
              החלף secret
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="text-red-400 hover:text-red-300"
            >
              נקה
            </button>
          </>
        )}
      </div>
    </div>
  );
}

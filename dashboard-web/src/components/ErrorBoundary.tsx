'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/Button';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production with Sentry — sent. In localhost without DSN — Sentry.captureException
    // is a no-op because init was never called. Safe to call unconditionally.
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
    // Also console.error to Vercel logs (in case Sentry is not configured).
    console.error('Dashboard crashed:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
          <div className="max-w-md rounded-2xl border border-glass-edge bg-glass-1 p-6 shadow-sheet space-y-4">
            <h1 className="text-xl font-semibold text-ink">משהו השתבש</h1>
            <p className="text-sm text-ink-secondary">
              הדשבורד נתקל בשגיאה בלתי צפויה. ניתן לרענן את הדף או לנסות שוב.
            </p>
            {/* In development we render the raw message to aid local debugging.
              * In production we show a stable Hebrew message — raw error.message
              * can contain server paths (e.g. ENOENT '.env.production.local'),
              * source-file names, and internal call sites that leak implementation
              * details into screenshots / support tickets. React's text-escape
              * protects against XSS but does NOT prevent information disclosure. */}
            <p className="text-[11px] text-ink-muted font-mono break-all">
              {process.env.NODE_ENV === 'development'
                ? (this.state.error?.message ?? 'Unknown error')
                : 'שגיאה פנימית. נסה לרענן את הדף.'}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={this.handleReset}
              >
                נסה שוב
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.location.reload()}
              >
                רענן דף
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

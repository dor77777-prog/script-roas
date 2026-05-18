'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';
import * as Sentry from '@sentry/nextjs';

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
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-2xl border border-borderSubtle bg-surface p-6 shadow-lg space-y-4">
            <h1 className="text-xl font-semibold text-text-primary">משהו השתבש</h1>
            <p className="text-sm text-text-secondary">
              הדשבורד נתקל בשגיאה בלתי צפויה. ניתן לרענן את הדף או לנסות שוב.
            </p>
            <p className="text-[11px] text-text-muted font-mono break-all">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={this.handleReset}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                נסה שוב
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg border border-borderSubtle px-4 py-2 text-sm font-medium text-text-primary hover:bg-surfaceMuted"
              >
                רענן דף
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

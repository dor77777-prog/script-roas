// @vitest-environment jsdom
//
// dashboard-web/src/components/operator/__tests__/manualOverridesTikTokOption.dom.test.tsx
//
// Task 10 (Plan A foundation/framing, 2026-06-02): the manual-overrides
// editor must offer TikTok as a correctable platform alongside Meta and
// Google. This guards ALL_PLATFORMS so the operator UI never drifts back to
// the meta/google-only list once the validator + DB CHECK accept 'tiktok'.
//
// The form (and its platform <option>s) only mounts once SWR has resolved
// (the component returns a "loading" paragraph while isLoading is true), so —
// following the established operator DOM-test pattern (MetaBucPanel) — we mock
// `swr` to hand back resolved, empty-list data and mock the real network
// client at its actual specifier (@/lib/operatorClient, not @/lib/operatorFetch).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: [] },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}));

vi.mock('@/lib/operatorClient', () => ({
  operatorFetch: vi.fn(async () => ({
    json: async () => ({ rows: [] }),
    status: 200,
  })),
}));

import { ManualOverridesCrud } from '@/components/operator/ManualOverridesCrud';

afterEach(() => cleanup());

describe('ManualOverridesCrud platform <select> (2026-06-02)', () => {
  it('renders a tiktok option alongside meta and google', () => {
    const { container } = render(<ManualOverridesCrud />);
    const values = Array.from(container.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toContain('meta');
    expect(values).toContain('google');
    expect(values).toContain('tiktok');
  });
});

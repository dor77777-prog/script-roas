// dashboard-web/src/components/__tests__/AnnotationsPanel.dom.test.tsx
//
// Horizon re-skin (Wave 3.6) — DOM tests for the re-skinned "יומן אירועים"
// event-log strip. The re-skin is LOOK-ONLY: these tests pin BOTH the new
// Horizon chrome (Card recipe, icon-circle, lucide chevron, no emoji glyphs)
// AND the preserved behaviour (expand/collapse, add/edit/delete CRUD, the
// localStorage contract + `roas-annotations-changed` event).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotationsPanel } from '@/components/AnnotationsPanel';
import { readAnnotations, type Annotation } from '@/lib/annotations';

const RANGE = { from: '2026-06-01', to: '2026-06-30' };

// Emoji codepoint ranges (pictographs, dingbats, symbols-and-arrows) — used to
// assert the UI carries NO emoji glyph (Horizon icon language = lucide only).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/u;

function seed(items: Annotation[]) {
  window.localStorage.setItem('roas-dashboard:annotations', JSON.stringify(items));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('<AnnotationsPanel> — Horizon chrome (re-skin)', () => {
  it('renders the title + collapsed chevron (lucide), no ▼/◀ text glyphs', () => {
    const { container } = render(<AnnotationsPanel range={RANGE} store="All" />);
    expect(screen.getByText('יומן אירועים')).toBeInTheDocument();
    // The collapsed/expanded indicator is a lucide <svg>, not a ▼/◀ char.
    expect(container.textContent ?? '').not.toMatch(/[▼◀]/);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('the lead is a Horizon icon-circle on the pill-track well (h-10 w-10 rounded-full)', () => {
    const { container } = render(<AnnotationsPanel range={RANGE} store="All" />);
    const circle = container.querySelector('span.rounded-full.bg-pill-track');
    expect(circle).not.toBeNull();
    expect(circle!.className).toContain('h-10');
    expect(circle!.className).toContain('w-10');
  });

  it('carries NO emoji glyph anywhere in the UI (collapsed)', () => {
    const { container } = render(<AnnotationsPanel range={RANGE} store="All" />);
    expect(container.textContent ?? '').not.toMatch(EMOJI);
  });

  it('renders per-kind lucide icons (not emoji) for in-scope annotations', () => {
    seed([
      { id: 'a1', date: '2026-06-10', kind: 'launch', title: 'השקת קיץ', createdAt: 1 },
      { id: 'a2', date: '2026-06-12', kind: 'budget', title: 'הרמת תקציב', createdAt: 2 },
    ]);
    const { container } = render(<AnnotationsPanel range={RANGE} store="All" />);
    // Expand the panel.
    fireEvent.click(screen.getByRole('button', { name: /יומן אירועים/ }));
    expect(screen.getByText('השקת קיץ')).toBeInTheDocument();
    expect(screen.getByText('הרמת תקציב')).toBeInTheDocument();
    // No emoji in any rendered row; each kind chip is a lucide <svg> in a circle.
    expect(container.textContent ?? '').not.toMatch(EMOJI);
    const kindCircles = container.querySelectorAll('span.rounded-full svg');
    expect(kindCircles.length).toBeGreaterThanOrEqual(2);
  });
});

describe('<AnnotationsPanel> — preserved behaviour (no info loss)', () => {
  it('expands / collapses on header click (aria-expanded)', () => {
    render(<AnnotationsPanel range={RANGE} store="All" />);
    const header = screen.getByRole('button', { name: /יומן אירועים/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    // Add-event affordance shows when open.
    expect(screen.getByText('תעד אירוע חדש')).toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('ADD: writes a new annotation to localStorage + fires roas-annotations-changed', () => {
    const onChange = vi.fn();
    window.addEventListener('roas-annotations-changed', onChange);
    render(<AnnotationsPanel range={RANGE} store="All" />);
    fireEvent.click(screen.getByRole('button', { name: /יומן אירועים/ }));
    fireEvent.click(screen.getByText('תעד אירוע חדש'));
    const title = screen.getByPlaceholderText(/השקת מבצע חורף/);
    fireEvent.change(title, { target: { value: 'אירוע חדש לבדיקה' } });
    // The date defaults to today (Israel) which may be outside RANGE, so set it
    // in-range to keep the row visible; CRUD persistence is the assertion.
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));

    const stored = readAnnotations();
    expect(stored.some((a) => a.title === 'אירוע חדש לבדיקה')).toBe(true);
    expect(onChange).toHaveBeenCalled();
    window.removeEventListener('roas-annotations-changed', onChange);
  });

  it('DELETE: removes an annotation from localStorage', () => {
    seed([{ id: 'a1', date: '2026-06-10', kind: 'sale', title: 'מבצע למחיקה', createdAt: 1 }]);
    render(<AnnotationsPanel range={RANGE} store="All" />);
    fireEvent.click(screen.getByRole('button', { name: /יומן אירועים/ }));
    expect(screen.getByText('מבצע למחיקה')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'מחק' }));
    expect(readAnnotations().some((a) => a.id === 'a1')).toBe(false);
  });

  it('EDIT: opens the inline form and updates the annotation', () => {
    seed([{ id: 'a1', date: '2026-06-10', kind: 'pricing', title: 'מחיר ישן', createdAt: 1 }]);
    render(<AnnotationsPanel range={RANGE} store="All" />);
    fireEvent.click(screen.getByRole('button', { name: /יומן אירועים/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ערוך' }));
    const title = screen.getByDisplayValue('מחיר ישן');
    fireEvent.change(title, { target: { value: 'מחיר חדש' } });
    // While editing, the inline form's "שמור" is the only save button on screen.
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    expect(readAnnotations().find((a) => a.id === 'a1')?.title).toBe('מחיר חדש');
  });

  it('scopes the list to the current range (out-of-range events hidden)', () => {
    seed([
      { id: 'in', date: '2026-06-10', kind: 'launch', title: 'בטווח', createdAt: 1 },
      { id: 'out', date: '2026-01-01', kind: 'launch', title: 'מחוץ לטווח', createdAt: 2 },
    ]);
    render(<AnnotationsPanel range={RANGE} store="All" />);
    fireEvent.click(screen.getByRole('button', { name: /יומן אירועים/ }));
    expect(screen.getByText('בטווח')).toBeInTheDocument();
    expect(screen.queryByText('מחוץ לטווח')).toBeNull();
  });
});

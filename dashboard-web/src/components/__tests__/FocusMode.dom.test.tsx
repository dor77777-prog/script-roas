import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FocusMode } from '../FocusMode';

afterEach(() => {
  // Focus-mode mutates documentElement; reset between tests so a leaked
  // data-focus-mode attribute can't make a later assertion pass/fail spuriously.
  document.documentElement.removeAttribute('data-focus-mode');
});

describe('FocusMode', () => {
  it('toggles data-focus-mode on document.documentElement when ⌘. (period) is pressed', () => {
    render(<FocusMode />);
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
    fireEvent.keyDown(document, { key: '.', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).toBe('on');
    fireEvent.keyDown(document, { key: '.', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
  });

  it('also toggles on Ctrl+. (Windows/Linux chord)', () => {
    render(<FocusMode />);
    fireEvent.keyDown(document, { key: '.', ctrlKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).toBe('on');
  });

  /**
   * reskin-w2 collision fix: FocusMode used to bind ⌘\, the SAME chord the
   * Sidebar binds for its pin-toggle — both document-level listeners fired on
   * one keypress. FocusMode moved to ⌘. so ⌘\ now belongs to the pin alone.
   * This guards that FocusMode no longer responds to ⌘\.
   */
  it('does NOT respond to ⌘\\ anymore (chord released to the Sidebar pin)', () => {
    render(<FocusMode />);
    fireEvent.keyDown(document, { key: '\\', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
    fireEvent.keyDown(document, { key: '\\', ctrlKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
  });
});

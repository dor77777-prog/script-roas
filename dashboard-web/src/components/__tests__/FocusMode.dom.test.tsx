import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FocusMode } from '../FocusMode';

describe('FocusMode', () => {
  it('toggles data-focus-mode on document.documentElement when ⌘\\ pressed', () => {
    render(<FocusMode />);
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
    fireEvent.keyDown(document, { key: '\\', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).toBe('on');
    fireEvent.keyDown(document, { key: '\\', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
  });
});

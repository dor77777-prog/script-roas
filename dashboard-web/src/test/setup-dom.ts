import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React 19 ships with built-in act() warnings under jsdom. The matcher
// extensions above add expect(...).toBeInTheDocument() etc. and run once
// per test file before describe blocks execute.
//
// @testing-library/react auto-cleanup relies on a global `afterEach`.
// With `globals: false` (our config), the global is not present, so
// cleanup must be called explicitly. Without this, DOM nodes from previous
// tests accumulate and cause "Found multiple elements" errors.
afterEach(() => {
  cleanup();
});

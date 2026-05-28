import '@testing-library/jest-dom/vitest';

// React 19 ships with built-in act() warnings under jsdom. The matcher
// extensions above add expect(...).toBeInTheDocument() etc. and run once
// per test file before describe blocks execute.

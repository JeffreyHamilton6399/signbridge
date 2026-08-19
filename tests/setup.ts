import '@testing-library/jest-dom/vitest';

// jsdom has no structuredClone before Node 17 semantics land in every runner,
// and settings migration leans on it heavily.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

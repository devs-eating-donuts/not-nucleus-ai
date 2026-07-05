import { defineConfig } from 'vitest/config';

// Test config. Coverage is opt-in: `npm test -- --coverage` (v8 provider).
// Scope coverage to the testable logic — the pure shared layer and the
// Node-only main services — and exclude the renderer (jsdom-less here),
// type-only files, and the tests themselves.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/services/**/*.ts', 'src/main/ipc/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/shared/banter.json'],
      reporter: ['text-summary', 'text'],
    },
  },
});

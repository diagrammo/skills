import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // A hang guard, not a performance budget: the fixture tests shell out to
    // git, which is slow on a loaded machine. Never assert on wall-clock time.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/suites/**/*.test.ts'],
    globalTeardown: ['./tests/global-teardown.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});

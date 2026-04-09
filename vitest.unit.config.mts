import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    __GEMINI_OAUTH_CLIENT_ID__:     JSON.stringify(process.env['GEMINI_OAUTH_CLIENT_ID']     ?? ''),
    __GEMINI_OAUTH_CLIENT_SECRET__: JSON.stringify(process.env['GEMINI_OAUTH_CLIENT_SECRET'] ?? ''),
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    testTimeout: 5000,
    fileParallelism: true,
    setupFiles: ['./tests/unit/setup.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});

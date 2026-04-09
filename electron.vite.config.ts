import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';

// Load secrets from .env.local (dev) or .env.signing (CI/release builds).
// Neither file is committed — see .env.local.template for setup instructions.
// Variables already in the environment (e.g. from CI) take precedence.
for (const file of ['.env.local', '.env.signing']) {
  const p = resolve(__dirname, file);
  if (existsSync(p)) loadDotenv({ path: p, override: false });
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Inject build-time constants into the main process bundle.
    // These are replaced with string literals by Vite at compile time.
    define: {
      __GEMINI_OAUTH_CLIENT_ID__:     JSON.stringify(process.env['GEMINI_OAUTH_CLIENT_ID']     ?? ''),
      __GEMINI_OAUTH_CLIENT_SECRET__: JSON.stringify(process.env['GEMINI_OAUTH_CLIENT_SECRET'] ?? ''),
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          'broker-entry': 'src/broker/entry.ts',
        },
        external: ['node-pty', 'better-sqlite3', '@vscode/ripgrep'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    server: {
      watch: {
        usePolling: true,
        interval: 500,
      },
    },
  },
});

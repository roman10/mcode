import { vi, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { MockDatabase } from './sqlite-test-provider';

// Set environment to test
process.env.NODE_ENV = 'test';

// Initialize the wasm database once for all tests
beforeAll(async () => {
  if (!MockDatabase.innerDb) {
    const SQL = await initSqlJs();
    MockDatabase.innerDb = new SQL.Database();
    MockDatabase.innerDb.run('PRAGMA foreign_keys = ON');
  }
});

// Global mock for better-sqlite3 BEFORE it is imported by src/main/db.ts
vi.mock('better-sqlite3', () => {
  return {
    default: MockDatabase,
  };
});

// Global mock for electron
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/mcode-test-userdata';
      return `/tmp/mcode-test-${name}`;
    },
    isPackaged: false,
    getVersion: () => '0.0.0-test',
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// Mock logger to avoid spamming test output
vi.mock('../../src/main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

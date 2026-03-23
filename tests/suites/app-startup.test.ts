import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  timestamp: number;
  args: string[];
}

describe('app startup', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('responds to renderer bridge queries after startup', async () => {
    const entries = await client.callToolJson<ConsoleEntry[]>('app_get_console_logs', {
      limit: 10,
    });

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.every((entry) => Array.isArray(entry.args))).toBe(true);
  });
});
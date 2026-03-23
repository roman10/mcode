import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

describe('app introspection tools', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('returns app version as non-empty string', async () => {
    const version = await client.callToolText('app_get_version');
    expect(version).toBeTruthy();
    // Semver-ish: at least "X.Y.Z"
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns console logs as array', async () => {
    const logs = await client.callToolJson<unknown[]>('app_get_console_logs', {});
    expect(Array.isArray(logs)).toBe(true);
  });

  it('filters console logs by level', async () => {
    const errors = await client.callToolJson<Array<{ level: string }>>(
      'app_get_console_logs',
      { level: 'error' },
    );
    expect(Array.isArray(errors)).toBe(true);
    for (const entry of errors) {
      expect(entry.level).toBe('error');
    }
  });

  it('respects console log limit', async () => {
    const logs = await client.callToolJson<unknown[]>('app_get_console_logs', {
      limit: 3,
    });
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeLessThanOrEqual(3);
  });

  it('returns HMR events as array', async () => {
    const events = await client.callToolJson<unknown[]>('app_get_hmr_events', {});
    expect(Array.isArray(events)).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

interface SleepBlockerStatus {
  enabled: boolean;
  blocking: boolean;
}

describe('app sleep prevention', () => {
  const client = new McpTestClient();
  let originalEnabled: boolean;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    const status = await client.callToolJson<SleepBlockerStatus>(
      'app_get_sleep_blocker_status',
    );
    originalEnabled = status.enabled;
  });

  afterAll(async () => {
    // Restore original state
    await client.callTool('app_set_prevent_sleep', {
      enabled: originalEnabled,
    });
    await client.disconnect();
  });

  it('get_sleep_blocker_status returns valid shape', async () => {
    const status = await client.callToolJson<SleepBlockerStatus>(
      'app_get_sleep_blocker_status',
    );
    expect(typeof status.enabled).toBe('boolean');
    expect(typeof status.blocking).toBe('boolean');
  });

  it('set_prevent_sleep enables sleep prevention', async () => {
    await client.callTool('app_set_prevent_sleep', { enabled: true });
    const status = await client.callToolJson<SleepBlockerStatus>(
      'app_get_sleep_blocker_status',
    );
    expect(status.enabled).toBe(true);
  });

  it('set_prevent_sleep disables sleep prevention', async () => {
    await client.callTool('app_set_prevent_sleep', { enabled: false });
    const status = await client.callToolJson<SleepBlockerStatus>(
      'app_get_sleep_blocker_status',
    );
    expect(status.enabled).toBe(false);
  });

  it('toggling is idempotent', async () => {
    await client.callTool('app_set_prevent_sleep', { enabled: true });
    const result = await client.callTool('app_set_prevent_sleep', {
      enabled: true,
    });
    expect(result.isError).toBeFalsy();
    const status = await client.callToolJson<SleepBlockerStatus>(
      'app_get_sleep_blocker_status',
    );
    expect(status.enabled).toBe(true);
  });
});

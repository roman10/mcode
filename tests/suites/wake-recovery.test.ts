import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  timestamp: number;
  args: string[];
}

describe('app:wake → terminal atlas recovery', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('runs atlas recovery on app:wake without disturbing the terminal', async () => {
    const marker = `wake-recovery-${Date.now()}`;
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await client.callTool('terminal_send_keys', {
      sessionId: session.sessionId,
      keys: `echo ${marker}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId: session.sessionId,
      pattern: marker,
      timeout_ms: 10000,
    });

    // Trigger the same IPC the powerMonitor 'unlock-screen' / 'resume' listener
    // would, so we exercise the renderer's wake-driven atlas recovery without
    // an actual screen lock.
    await client.callTool('app_simulate_wake');

    // Recovery is invisible (clearTextureAtlas only re-rasterizes glyph cache),
    // so assert two things: (a) the buffer content survives, and (b) the
    // recovery actually ran — the hook logs a one-liner naming the trigger.
    await sleep(100);

    const buffer = await client.callToolText('terminal_read_buffer', {
      sessionId: session.sessionId,
      lines: 200,
    });
    expect(buffer).toContain(marker);

    const logs = await client.callToolJson<ConsoleEntry[]>(
      'app_get_console_logs',
      { level: 'log', limit: 50 },
    );
    const wakeLog = logs.find((entry) =>
      entry.args.some((arg) => typeof arg === 'string' && arg.includes('[atlas-recovery] wake')),
    );
    expect(wakeLog, 'expected an [atlas-recovery] wake log entry').toBeDefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  getTileCount,
  waitForTileCount,
} from '../helpers';

describe('terminal I/O', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();

    const session = await createTestSession(client);
    sessionId = session.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);

    // Add tile so terminal buffer is rendered via xterm.js
    const before = await getTileCount(client);
    await client.callTool('layout_add_tile', { sessionId });
    await waitForTileCount(client, before + 1);
  });

  afterAll(async () => {
    try {
      await client.callTool('layout_remove_tile', { sessionId });
    } catch { /* best-effort */ }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('sends keys and reads output', async () => {
    // Send echo command
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: 'echo hello-mcode-test\\r',
    });

    // Wait for output to appear
    const result = await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: 'hello-mcode-test',
      timeout_ms: 10000,
    });

    expect(result).toContain('hello-mcode-test');
  });

  it('reads buffer with line limit', async () => {
    const buffer = await client.callToolText('terminal_read_buffer', {
      sessionId,
      lines: 5,
    });

    // Should return some text (at least from previous echo)
    expect(buffer.length).toBeGreaterThan(0);

    // Line count should be at most 5
    const lineCount = buffer.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(5);
  });

  it('gets terminal dimensions', async () => {
    const dims = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId },
    );

    expect(dims.cols).toBeGreaterThan(0);
    expect(dims.rows).toBeGreaterThan(0);
  });
});

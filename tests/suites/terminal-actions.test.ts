import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
} from '../helpers';

describe('terminal actions', () => {
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
    await client.callTool('layout_add_tile', { sessionId });
    await new Promise((r) => setTimeout(r, 500));
  });

  afterAll(async () => {
    try {
      await client.callTool('layout_remove_tile', { sessionId });
    } catch { /* best-effort */ }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('clear removes scrollback', async () => {
    const marker = `clear-test-${Date.now()}`;

    // Write marker to terminal
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `echo ${marker}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: marker,
      timeout_ms: 10000,
    });

    // Clear the terminal
    await client.callTool('terminal_execute_action', {
      sessionId,
      action: 'clear',
    });
    await new Promise((r) => setTimeout(r, 250));

    // Buffer should no longer contain the marker
    const buffer = await client.callToolText('terminal_read_buffer', {
      sessionId,
    });
    expect(buffer).not.toContain(marker);
  });

  it('selectAll + copy returns buffer content', async () => {
    const marker = `copy-test-${Date.now()}`;

    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `echo ${marker}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: marker,
      timeout_ms: 10000,
    });

    // Select all then copy
    await client.callTool('terminal_execute_action', {
      sessionId,
      action: 'selectAll',
    });
    await new Promise((r) => setTimeout(r, 250));

    const copyResult = await client.callToolText('terminal_execute_action', {
      sessionId,
      action: 'copy',
    });
    expect(copyResult).toContain(marker);
  });

  it('drop_files writes path to terminal', async () => {
    const filePath = join(process.cwd(), 'package.json');

    await client.callTool('terminal_drop_files', {
      sessionId,
      filePaths: [filePath],
    });
    await new Promise((r) => setTimeout(r, 250));

    const buffer = await client.callToolText('terminal_read_buffer', {
      sessionId,
    });
    expect(buffer).toContain('package.json');
  });
});

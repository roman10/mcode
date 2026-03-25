import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

describe('terminal advanced operations', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    const session = await createTestSession(client);
    sessionId = session.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('resizes terminal and verifies new dimensions', async () => {
    const newCols = 120;
    const newRows = 40;

    const result = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_resize',
      { sessionId, cols: newCols, rows: newRows },
    );

    expect(result.cols).toBe(newCols);
    expect(result.rows).toBe(newRows);

    // Verify via session_info (PTY-level)
    const info = await client.callToolJson<{ cols: number; rows: number }>(
      'session_info',
      { sessionId },
    );
    expect(info.cols).toBe(newCols);
    expect(info.rows).toBe(newRows);
  });

  it('sends Ctrl+C to interrupt a running command', async () => {
    // Start a long-running command
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: 'sleep 60\\r',
    });

    // Give it a moment to start
    await sleep(300);

    // Send Ctrl+C
    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: '\\x03',
    });

    // Wait for the shell prompt to come back ($ or bash prompt)
    const buffer = await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: '\\$',
      timeout_ms: 5000,
    });

    expect(buffer).toBeTruthy();
  });

  it('wait_for_content times out on non-matching pattern', async () => {
    const result = await client.callTool('terminal_wait_for_content', {
      sessionId,
      pattern: 'THIS_PATTERN_WILL_NEVER_MATCH_12345',
      timeout_ms: 1000,
    });

    expect(result.isError).toBe(true);
    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    expect(text).toContain('Timeout');
  });

  it('handles multiple sequential commands', async () => {
    const marker = `seq-${Date.now()}`;

    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `echo first-${marker}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: `first-${marker}`,
      timeout_ms: 5000,
    });

    await client.callTool('terminal_send_keys', {
      sessionId,
      keys: `echo second-${marker}\\r`,
    });
    const buffer = await client.callToolText('terminal_wait_for_content', {
      sessionId,
      pattern: `second-${marker}`,
      timeout_ms: 5000,
    });

    expect(buffer).toContain(`first-${marker}`);
    expect(buffer).toContain(`second-${marker}`);
  });
});

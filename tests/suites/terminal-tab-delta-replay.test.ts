import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

describe('terminal tab delta replay', () => {
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

  it('catches up output produced while the tab was hidden, preserving pre-hide scrollback', async () => {
    // Tab A — produce a pre-hide marker.
    const preHide = `pre-hide-${Date.now()}`;
    const sessionA = await createTestSession(client);
    sessionIds.push(sessionA.sessionId);
    await waitForActive(client, sessionA.sessionId);

    await client.callTool('terminal_send_keys', {
      sessionId: sessionA.sessionId,
      keys: `echo ${preHide}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId: sessionA.sessionId,
      pattern: preHide,
      timeout_ms: 10000,
    });

    // Tab B — creating it makes A hidden (isVisible=false).
    const sessionB = await createTestSession(client);
    sessionIds.push(sessionB.sessionId);
    await waitForActive(client, sessionB.sessionId);

    // Drive output into hidden Tab A. Bash queues this on the PTY; it runs
    // synchronously in A. The delta-replay catch-up should surface this on
    // reveal even though the live pty.onData writes were dropped while hidden.
    const duringHide = `during-hide-${Date.now()}`;
    await client.callTool('terminal_send_keys', {
      sessionId: sessionA.sessionId,
      keys: `echo ${duringHide}\\r`,
    });

    // Give bash time to produce output into the broker ring buffer.
    await sleep(500);

    // Reveal Tab A.
    await client.callTool('terminal_panel_activate_tab', {
      sessionId: sessionA.sessionId,
    });
    // Allow the catch-up IPC round-trip + term.write to settle.
    await sleep(500);

    const bufferA = await client.callToolText('terminal_read_buffer', {
      sessionId: sessionA.sessionId,
      lines: 200,
    });

    // Both pre-hide scrollback AND the during-hide output must be present —
    // delta-replay appends only what arrived during the hidden window without
    // clearing the existing scrollback.
    expect(bufferA).toContain(preHide);
    expect(bufferA).toContain(duringHide);
  });
});

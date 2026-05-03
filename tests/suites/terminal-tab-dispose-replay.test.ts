import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

describe('terminal tab dispose-and-replay', () => {
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

  it('replays buffered output into the viewport after a hidden tile is disposed and reactivated', async () => {
    // Session A — write a marker so we can assert it appears after the dispose+replay round-trip.
    const markerA = `dispose-replay-A-${Date.now()}`;
    const sessionA = await createTestSession(client);
    sessionIds.push(sessionA.sessionId);
    await waitForActive(client, sessionA.sessionId);

    await client.callTool('terminal_send_keys', {
      sessionId: sessionA.sessionId,
      keys: `echo ${markerA}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId: sessionA.sessionId,
      pattern: markerA,
      timeout_ms: 10000,
    });

    // Session B — created so A is hidden (isVisible=false).
    const sessionB = await createTestSession(client);
    sessionIds.push(sessionB.sessionId);
    await waitForActive(client, sessionB.sessionId);

    // Trigger the same dispose path the 5-min HIDDEN_TILE_DISPOSE_MS timer would,
    // so we exercise dispose-then-replay without waiting.
    const disposeRes = await client.callToolJson<{ ok: boolean }>(
      'terminal_force_dispose_hidden',
      { sessionId: sessionA.sessionId },
    );
    expect(disposeRes.ok).toBe(true);

    // Reactivate A → fresh xterm, replay broker ring buffer.
    await client.callTool('terminal_panel_activate_tab', {
      sessionId: sessionA.sessionId,
    });
    // Allow the new mount + setTimeout(0) fit + IPC replay round-trip to settle.
    await sleep(500);

    // The replayed buffer must be visible in the viewport — this is the bug:
    // before the fix, replay landed before fit and prompts/markers ended up
    // off-screen on the fresh 80x24 grid, leaving the viewport blank.
    const bufferA = await client.callToolText('terminal_read_buffer', {
      sessionId: sessionA.sessionId,
      lines: 200,
    });
    expect(bufferA).toContain(markerA);
  });
});

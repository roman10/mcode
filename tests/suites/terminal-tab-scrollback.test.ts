import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  sleep,
} from '../helpers';

describe('terminal tab scrollback preservation', () => {
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

  it('preserves scrollback when switching between bottom panel tabs', async () => {
    // Create session A and write a marker
    const markerA = `scrollback-A-${Date.now()}`;
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

    // Create session B — this makes A's tab hidden (isVisible=false)
    const markerB = `scrollback-B-${Date.now()}`;
    const sessionB = await createTestSession(client);
    sessionIds.push(sessionB.sessionId);
    await waitForActive(client, sessionB.sessionId);

    await client.callTool('terminal_send_keys', {
      sessionId: sessionB.sessionId,
      keys: `echo ${markerB}\\r`,
    });
    await client.callToolText('terminal_wait_for_content', {
      sessionId: sessionB.sessionId,
      pattern: markerB,
      timeout_ms: 10000,
    });

    // Switch back to session A
    await client.callTool('terminal_panel_activate_tab', {
      sessionId: sessionA.sessionId,
    });
    await sleep(250);

    // Session A's scrollback should still contain the original marker
    const bufferA = await client.callToolText('terminal_read_buffer', {
      sessionId: sessionA.sessionId,
    });
    expect(bufferA).toContain(markerA);

    // Session B (now hidden) should also still have its content
    const bufferB = await client.callToolText('terminal_read_buffer', {
      sessionId: sessionB.sessionId,
    });
    expect(bufferB).toContain(markerB);
  });
});

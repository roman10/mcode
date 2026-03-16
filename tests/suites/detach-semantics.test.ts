import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  getTileCount,
  type SessionInfo,
} from '../helpers';

describe('detach semantics (close tile != kill session)', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('removing tile does not kill the session', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    // Add tile
    await client.callTool('layout_add_tile', { sessionId: session.sessionId });
    await new Promise((r) => setTimeout(r, 300));

    // Remove tile
    await client.callTool('layout_remove_tile', {
      sessionId: session.sessionId,
    });
    await new Promise((r) => setTimeout(r, 300));

    // Session should still be active
    const status = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId: session.sessionId },
    );
    expect(status.status).toBe('active');
  });

  it('can re-add tile after detach', async () => {
    const sessionId = sessionIds[0];
    const before = await getTileCount(client);

    await client.callTool('layout_add_tile', { sessionId });
    await new Promise((r) => setTimeout(r, 300));

    const after = await getTileCount(client);
    expect(after).toBe(before + 1);
  });

  it('can kill a detached session', async () => {
    const sessionId = sessionIds[0];

    // Remove tile first (detach)
    await client.callTool('layout_remove_tile', { sessionId });
    await new Promise((r) => setTimeout(r, 300));

    // Kill
    await client.callTool('session_kill', { sessionId });
    await client.callToolJson('session_wait_for_status', {
      sessionId,
      status: 'ended',
      timeout_ms: 15000,
    });

    const session = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId },
    );
    expect(session.status).toBe('ended');
  });
});

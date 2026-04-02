import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForActive,
  cleanupSessions,
  getTileCount,
  waitForTileCount,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('detach semantics (close tile != kill session)', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    const session = await createLiveClaudeTestSession(client);
    sessionId = session.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('detach lifecycle: remove tile, re-add, kill detached', async () => {
    // --- Section 1: Removing tile does not kill the session ---
    const tilesBefore = await getTileCount(client);

    await client.callTool('layout_remove_tile', { sessionId });
    await waitForTileCount(client, tilesBefore - 1);

    const afterDetach = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId },
    );
    expect(afterDetach.status).toBe('active');

    // --- Section 2: Can re-add tile after detach ---
    const tilesAfterDetach = await getTileCount(client);

    await client.callTool('layout_add_tile', { sessionId });
    await waitForTileCount(client, tilesAfterDetach + 1);

    const tilesAfterReAdd = await getTileCount(client);
    expect(tilesAfterReAdd).toBe(tilesAfterDetach + 1);

    // --- Section 3: Can kill a detached session ---
    const tilesBeforeKill = await getTileCount(client);
    await client.callTool('layout_remove_tile', { sessionId });
    await waitForTileCount(client, tilesBeforeKill - 1);

    await client.callTool('session_kill', { sessionId });
    await client.callToolJson('session_wait_for_status', {
      sessionId,
      status: 'ended',
      timeout_ms: 15000,
    });

    const ended = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId },
    );
    expect(ended.status).toBe('ended');
  });
});

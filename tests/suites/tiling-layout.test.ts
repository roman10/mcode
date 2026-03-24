import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  getTileCount,
  waitForTileCount,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('tiling layout', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    // Remove tiles we added
    for (const id of sessionIds) {
      try {
        await client.callTool('layout_remove_tile', { sessionId: id });
      } catch { /* best-effort */ }
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('session creation auto-adds a tile', async () => {
    const before = await getTileCount(client);

    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    // session:created IPC listener in App.tsx auto-adds the tile
    await waitForTileCount(client, before + 1);

    const after = await getTileCount(client);
    expect(after).toBe(before + 1);
  });

  it('second session creation adds another tile', async () => {
    const before = await getTileCount(client);

    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await waitForTileCount(client, before + 1);

    const after = await getTileCount(client);
    expect(after).toBe(before + 1);
  });

  it('layout tree contains both session IDs', async () => {
    const tree = await client.callToolJson<unknown>('layout_get_tree');
    const treeStr = JSON.stringify(tree);

    for (const id of sessionIds) {
      expect(treeStr).toContain(id);
    }
  });

  it('removes a tile without killing the session', async () => {
    const sessionId = sessionIds[0];
    const before = await getTileCount(client);

    await client.callTool('layout_remove_tile', { sessionId });
    await waitForTileCount(client, before - 1);

    const after = await getTileCount(client);
    expect(after).toBe(before - 1);

    // Session should still be active
    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.status).toBe('active');
  });

  it('re-adds a removed tile', async () => {
    const sessionId = sessionIds[0];
    const before = await getTileCount(client);

    await client.callTool('layout_add_tile', { sessionId });
    await waitForTileCount(client, before + 1);

    const after = await getTileCount(client);
    expect(after).toBe(before + 1);
  });

  it('returns error when adding tile for non-existent session', async () => {
    const result = await client.callTool('layout_add_tile', {
      sessionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(result.isError).toBe(true);
  });

  it('auto-closes tile when session is killed', async () => {
    const before = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await waitForTileCount(client, before + 1);

    await killAndWaitEnded(client, session.sessionId);
    // TerminalTile's useEffect auto-closes on status → ended
    await waitForTileCount(client, before);

    const after = await getTileCount(client);
    expect(after).toBe(before);
  });
});

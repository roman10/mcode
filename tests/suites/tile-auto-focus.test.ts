import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  waitForTileCount,
  getTileCount,
  getSidebarSelected,
} from '../helpers';

describe('tile auto-focus', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let initialTileCount: number;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    initialTileCount = await getTileCount(client);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      try {
        await client.callTool('layout_remove_tile', { sessionId: id });
      } catch { /* best-effort */ }
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('newly created session is auto-selected in sidebar', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await waitForTileCount(client, initialTileCount + 1);

    const { selectedSessionId } = await getSidebarSelected(client);
    expect(selectedSessionId).toBe(session.sessionId);
  });

  it('second session steals focus from first', async () => {
    const session2 = await createLiveClaudeTestSession(client);
    sessionIds.push(session2.sessionId);
    await waitForActive(client, session2.sessionId);
    await waitForTileCount(client, initialTileCount + 2);

    const { selectedSessionId } = await getSidebarSelected(client);
    expect(selectedSessionId).toBe(session2.sessionId);
  });

  it('sidebar_select_session switches focus back to first session', async () => {
    const firstId = sessionIds[0];
    await client.callTool('sidebar_select_session', { sessionId: firstId });

    const { selectedSessionId } = await getSidebarSelected(client);
    expect(selectedSessionId).toBe(firstId);
  });
});

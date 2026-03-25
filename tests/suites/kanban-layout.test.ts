import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  killAndWaitEnded,
  cleanupSessions,
  injectHookEvent,
  getTileCount,
  getViewMode,
  setViewMode,
  getKanbanState,
  expandKanbanSession,
  collapseKanban,
  waitForTileCount,
  waitForViewMode,
  waitForAttention,
  waitForKanbanColumn,
  waitForKanbanCollapse,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('kanban layout', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let originalViewMode: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    // Save the original view mode so we can restore it after tests
    originalViewMode = await getViewMode(client);
  });

  afterAll(async () => {
    // Restore original view mode
    await setViewMode(client, originalViewMode as 'tiles' | 'kanban');
    // Remove tiles we may have added
    for (const id of sessionIds) {
      try {
        await client.callTool('layout_remove_tile', { sessionId: id });
      } catch { /* best-effort */ }
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('switches view mode to kanban and back', async () => {
    await setViewMode(client, 'kanban');
    expect(await getViewMode(client)).toBe('kanban');

    await setViewMode(client, 'tiles');
    expect(await getViewMode(client)).toBe('tiles');

    await setViewMode(client, 'kanban');
    expect(await getViewMode(client)).toBe('kanban');
  });

  it('groups active sessions into the working column', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);
    await waitForKanbanColumn(client, session.sessionId, 'working');

    const state = await getKanbanState(client);
    const workingIds = state.columns['working']?.map((s) => s.sessionId) ?? [];
    expect(workingIds).toContain(session.sessionId);
  });

  it('moves ended sessions to the completed column', async () => {
    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    await killAndWaitEnded(client, session.sessionId);
    await waitForKanbanColumn(client, session.sessionId, 'completed');

    const state = await getKanbanState(client);
    const completedIds = state.columns['completed']?.map((s) => s.sessionId) ?? [];
    expect(completedIds).toContain(session.sessionId);
  });

  it('moves sessions with high attention to needs-attention column', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);

    // Inject a PermissionRequest hook event to raise attention to high
    await injectHookEvent(client, session.sessionId, 'PermissionRequest', {
      toolName: 'file:write',
    });
    await waitForAttention(client, session.sessionId, 'action');

    const state = await getKanbanState(client);
    const needsAttentionIds = state.columns['needs-attention']?.map((s) => s.sessionId) ?? [];
    expect(needsAttentionIds).toContain(session.sessionId);
  });

  it('expands a session and reports expandedSessionId', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    await expandKanbanSession(client, session.sessionId);

    const state = await getKanbanState(client);
    expect(state.expandedSessionId).toBe(session.sessionId);

    await collapseKanban(client);

    const stateAfter = await getKanbanState(client);
    expect(stateAfter.expandedSessionId).toBeNull();
  });

  it('auto-collapses when expanded session is killed', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    await expandKanbanSession(client, session.sessionId);

    const before = await getKanbanState(client);
    expect(before.expandedSessionId).toBe(session.sessionId);

    // Kill the session — KanbanLayout's useEffect should auto-collapse
    await killAndWaitEnded(client, session.sessionId);
    await waitForKanbanCollapse(client);

    const after = await getKanbanState(client);
    expect(after.expandedSessionId).toBeNull();
  });

  it('clears expansion when switching view modes', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    await expandKanbanSession(client, session.sessionId);

    // Switch to tiles and back — expansion should be cleared
    await setViewMode(client, 'tiles');
    await waitForViewMode(client, 'tiles');
    await setViewMode(client, 'kanban');
    await waitForViewMode(client, 'kanban');

    const state = await getKanbanState(client);
    expect(state.expandedSessionId).toBeNull();
  });

  it('maintains tile tree in kanban mode', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);

    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    // Even in kanban mode, the mosaic tree should be updated
    const tilesAfter = await getTileCount(client);
    expect(tilesAfter).toBe(tilesBefore + 1);

    // Switch back to tiles — the session should have a tile
    await setViewMode(client, 'tiles');
    await waitForViewMode(client, 'tiles');

    const tree = await client.callToolText('layout_get_tree');
    expect(tree).toContain(`session:${session.sessionId}`);
  });

  it('removes tile from mosaic when session is killed in kanban mode', async () => {
    await setViewMode(client, 'kanban');

    const tilesBefore = await getTileCount(client);
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForTileCount(client, tilesBefore + 1);

    await killAndWaitEnded(client, session.sessionId);
    await waitForKanbanColumn(client, session.sessionId, 'completed');

    // Zombie tile fix (74bdabc): tile must be removed from mosaic even in kanban mode
    await waitForTileCount(client, tilesBefore);
    expect(await getTileCount(client)).toBe(tilesBefore);
  });
});

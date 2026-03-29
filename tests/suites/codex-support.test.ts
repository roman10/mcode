import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createCodexTestSession,
  getViewMode,
  setViewMode,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
  waitForSidebarSession,
  waitForKanbanSession,
} from '../helpers';

describe('codex support', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let originalViewMode: 'tiles' | 'kanban';

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    originalViewMode = await getViewMode(client) as 'tiles' | 'kanban';
  });

  afterEach(async () => {
    await setViewMode(client, originalViewMode);
    await cleanupSessions(client, sessionIds);
    sessionIds.length = 0;
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('creates a Codex session via MCP', async () => {
    const session = await createCodexTestSession(client, {
      label: `codex-${Date.now()}`,
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(session.sessionId);

    expect(session.sessionType).toBe('codex');
    expect(session.status).toBe('starting');
    expect(session.label).toMatch(/^\u2742 /);
    // hookMode is 'live' when the Codex hook bridge was configured at startup,
    // 'fallback' otherwise (e.g. if ~/.codex/ is not writable).
    expect(['live', 'fallback']).toContain(session.hookMode);
    expect(session.permissionMode).toBeUndefined();
    expect(session.enableAutoMode).toBeUndefined();
  });

  it('omits Claude-only fields for Codex sessions even if they are provided', async () => {
    const session = await createCodexTestSession(client, {
      label: `codex-flags-${Date.now()}`,
      permissionMode: 'auto',
      effort: 'high',
      enableAutoMode: true,
      allowBypassPermissions: true,
      worktree: 'should-be-ignored',
    });
    sessionIds.push(session.sessionId);
    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });

    expect(status.permissionMode).toBeUndefined();
    expect(status.effort).toBeUndefined();
    expect(status.enableAutoMode).toBeUndefined();
    expect(status.allowBypassPermissions).toBeUndefined();
    expect(status.worktree).toBeNull();
  });

  it('shows Codex sessions in the sidebar and kanban as agent sessions', async () => {
    await setViewMode(client, 'kanban');
    const session = await createCodexTestSession(client, {
      label: `codex-kanban-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    const sidebarEntry = await waitForSidebarSession(client, session.sessionId);
    expect(sidebarEntry.sessionType).toBe('codex');

    const column = await waitForKanbanSession(client, session.sessionId);
    expect(['working', 'ready']).toContain(column);
  });
});

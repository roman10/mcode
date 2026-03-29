import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createCopilotTestSession,
  getViewMode,
  setViewMode,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
  waitForIdle,
} from '../helpers';

describe('copilot support', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let originalViewMode: 'tiles' | 'kanban';

  async function waitForSidebarSession(sessionId: string, timeoutMs = 10000): Promise<SessionInfo> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const sessions = await client.callToolJson<SessionInfo[]>('sidebar_get_sessions');
      const found = sessions.find((session) => session.sessionId === sessionId);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for sidebar session ${sessionId}`);
  }

  async function waitForKanbanSession(sessionId: string, timeoutMs = 10000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const kanban = await client.callToolJson<{
        columns: Record<string, SessionInfo[]>;
        expandedSessionId: string | null;
      }>('kanban_get_columns');
      for (const [column, sessions] of Object.entries(kanban.columns)) {
        if (sessions.some((session) => session.sessionId === sessionId)) {
          return column;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for kanban session ${sessionId}`);
  }

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

  it('creates a Copilot session via MCP', async () => {
    const session = await createCopilotTestSession(client, {
      label: `copilot-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    expect(session.sessionType).toBe('copilot');
    expect(session.status).toBe('starting');
    expect(session.label).toMatch(/^\u2605 /);
    expect(['live', 'fallback']).toContain(session.hookMode);
    expect(session.permissionMode).toBeUndefined();
    expect(session.enableAutoMode).toBeUndefined();

    await waitForIdle(client, session.sessionId);
  });

  it('omits Claude-only fields for Copilot sessions even if they are provided', async () => {
    const session = await createCopilotTestSession(client, {
      label: `copilot-flags-${Date.now()}`,
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

  it('shows Copilot sessions in the sidebar and kanban as agent sessions', async () => {
    await setViewMode(client, 'kanban');
    const session = await createCopilotTestSession(client, {
      label: `copilot-kanban-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    const sidebarEntry = await waitForSidebarSession(session.sessionId);
    expect(sidebarEntry.sessionType).toBe('copilot');

    const column = await waitForKanbanSession(session.sessionId);
    expect(['working', 'ready']).toContain(column);
  });

  it('persists an explicit Copilot model and launches with --model', async () => {
    const session = await createCopilotTestSession(client, {
      label: `copilot-model-${Date.now()}`,
      model: 'gpt-4.1',
    });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.model).toBe('gpt-4.1');
  });

  it('sets Copilot session ID via MCP tool', async () => {
    const session = await createCopilotTestSession(client);
    sessionIds.push(session.sessionId);

    const testUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const updated = await client.callToolJson<SessionInfo>('session_set_copilot_session_id', {
      sessionId: session.sessionId,
      copilotSessionId: testUuid,
    });
    expect(updated.copilotSessionId).toBe(testUuid);

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.copilotSessionId).toBe(testUuid);
  });
});

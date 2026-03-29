import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createGeminiTestSession,
  getViewMode,
  setViewMode,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
  waitForIdle,
  waitForSidebarSession,
  waitForKanbanSession,
} from '../helpers';

describe('gemini support', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let originalViewMode: 'tiles' | 'kanban';

  async function waitForGeminiSessionId(sessionId: string, timeoutMs = 10000): Promise<SessionInfo> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const session = await client.callToolJson<SessionInfo>('session_get_status', { sessionId });
      if (session.geminiSessionId) return session;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for Gemini session ID on ${sessionId}`);
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

  it('creates a Gemini session via MCP', async () => {
    const session = await createGeminiTestSession(client, {
      label: `gemini-${Date.now()}`,
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(session.sessionId);

    expect(session.sessionType).toBe('gemini');
    expect(session.status).toBe('starting');
    expect(session.label).toMatch(/^\u2726 /);
    expect(session.hookMode).toBe('live');
    expect(session.permissionMode).toBeUndefined();
    expect(session.enableAutoMode).toBeUndefined();

    await waitForIdle(client, session.sessionId);
    const withGeminiId = await waitForGeminiSessionId(session.sessionId);
    expect(withGeminiId.geminiSessionId).toBe('gemini-fixture-session');
  });

  it('omits Claude-only fields for Gemini sessions even if they are provided', async () => {
    const session = await createGeminiTestSession(client, {
      label: `gemini-flags-${Date.now()}`,
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

  it('shows Gemini sessions in the sidebar and kanban as agent sessions', async () => {
    await setViewMode(client, 'kanban');
    const session = await createGeminiTestSession(client, {
      label: `gemini-kanban-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    const sidebarEntry = await waitForSidebarSession(client, session.sessionId);
    expect(sidebarEntry.sessionType).toBe('gemini');

    const column = await waitForKanbanSession(client, session.sessionId);
    expect(['working', 'ready']).toContain(column);
  });

  it('persists an explicit Gemini model and launches with --model', async () => {
    const session = await createGeminiTestSession(client, {
      label: `gemini-model-${Date.now()}`,
      model: 'gemini-2.5-pro',
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(session.sessionId);

    const idle = await waitForIdle(client, session.sessionId);
    expect(idle.model).toBe('gemini-2.5-pro');

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.model).toBe('gemini-2.5-pro');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  type SessionInfo,
} from '../helpers';

describe('sidebar sessions', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('shows created session in sidebar', async () => {
    const session = await createTestSession(client, { sessionType: 'terminal' });
    sessionIds.push(session.sessionId);

    // Give renderer time to process the created event
    await new Promise((r) => setTimeout(r, 500));

    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );
    const found = sidebarSessions.find(
      (s) => s.sessionId === session.sessionId,
    );
    expect(found).toBeDefined();
  });

  it('sidebar shows active status after transition', async () => {
    const sessionId = sessionIds[0];
    await waitForActive(client, sessionId);

    // Give renderer time to receive status update
    await new Promise((r) => setTimeout(r, 500));

    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );
    const found = sidebarSessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('active');
  });

  it('sidebar shows ended status after kill', async () => {
    const sessionId = sessionIds[0];
    await killAndWaitEnded(client, sessionId);

    // Give renderer time to update
    await new Promise((r) => setTimeout(r, 500));

    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );
    const found = sidebarSessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('ended');
  });

  it('set label persists to DB', async () => {
    const session = await createTestSession(client, { sessionType: 'terminal' });
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    const newLabel = `sidebar-rename-${Date.now()}`;
    await client.callTool('session_set_label', {
      sessionId: session.sessionId,
      label: newLabel,
    });

    // Verify label persisted via DB query (session_get_status reads from SQLite).
    // Note: sidebar Zustand store won't reflect label changes until a
    // session:label-change IPC channel is added.
    const dbSession = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId: session.sessionId },
    );
    expect(dbSession.label).toBe(newLabel);
  });

  it('DB and sidebar agree on session status', async () => {
    const dbSessions = await client.callToolJson<SessionInfo[]>('session_list');
    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );

    // For each session in our test, DB and sidebar should agree on status
    for (const id of sessionIds) {
      const dbEntry = dbSessions.find((s) => s.sessionId === id);
      const sidebarEntry = sidebarSessions.find((s) => s.sessionId === id);
      expect(dbEntry, `session ${id} missing from DB`).toBeDefined();
      expect(sidebarEntry, `session ${id} missing from sidebar`).toBeDefined();
      expect(sidebarEntry!.status).toBe(dbEntry!.status);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  getTileCount,
  waitForTileCount,
  type SessionInfo,
} from '../helpers';

describe('concurrent sessions', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  const SESSION_COUNT = 4;

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it(`creates ${SESSION_COUNT} sessions concurrently`, async () => {
    const promises = Array.from({ length: SESSION_COUNT }, () =>
      createTestSession(client),
    );
    const sessions = await Promise.all(promises);

    for (const s of sessions) {
      sessionIds.push(s.sessionId);
      expect(s.status).toBe('starting');
    }

    expect(sessionIds.length).toBe(SESSION_COUNT);
  });

  it('all sessions transition to active', async () => {
    const promises = sessionIds.map((id) => waitForActive(client, id));
    const results = await Promise.all(promises);

    for (const session of results) {
      expect(session.status).toBe('active');
    }
  });

  it('all sessions appear in session_list', async () => {
    const allSessions = await client.callToolJson<SessionInfo[]>(
      'session_list',
    );

    for (const id of sessionIds) {
      const found = allSessions.find((s) => s.sessionId === id);
      expect(found, `session ${id} missing from list`).toBeDefined();
      expect(found!.status).toBe('active');
    }
  });

  it('all sessions have tiles auto-added', async () => {
    // Wait for auto-tile IPC events to complete
    await waitForTileCount(client, SESSION_COUNT);

    const tree = await client.callToolJson<unknown>('layout_get_tree');
    const treeStr = JSON.stringify(tree);

    for (const id of sessionIds) {
      expect(treeStr).toContain(id);
    }
  });

  it('all sessions appear in sidebar', async () => {
    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );

    for (const id of sessionIds) {
      const found = sidebarSessions.find((s) => s.sessionId === id);
      expect(found, `session ${id} missing from sidebar`).toBeDefined();
    }
  });

  it('each session has independent terminal I/O', async () => {
    // Send unique echo to each session
    const markers = sessionIds.map((id, i) => ({
      id,
      marker: `concurrent-${i}-${Date.now()}`,
    }));

    for (const { id, marker } of markers) {
      await client.callTool('terminal_send_keys', {
        sessionId: id,
        keys: `echo ${marker}\\r`,
      });
    }

    // Wait for all outputs
    for (const { id, marker } of markers) {
      const buffer = await client.callToolText('terminal_wait_for_content', {
        sessionId: id,
        pattern: marker,
        timeout_ms: 10000,
      });
      expect(buffer).toContain(marker);
    }
  });

  it('kills all sessions and all transition to ended', async () => {
    const promises = sessionIds.map((id) => killAndWaitEnded(client, id));
    await Promise.all(promises);

    for (const id of sessionIds) {
      const session = await client.callToolJson<SessionInfo>(
        'session_get_status',
        { sessionId: id },
      );
      expect(session.status).toBe('ended');
      expect(session.endedAt).toBeTruthy();
    }
  });

  it('tile count returns to baseline after kills', async () => {
    // Wait for renderer to process all auto-close events
    // Use 0 as baseline since this suite creates its own sessions
    await waitForTileCount(client, 0, 15000);
    expect(await getTileCount(client)).toBe(0);
  });
});

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

describe('stress: 10 concurrent sessions', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  const SESSION_COUNT = 10;

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
    }

    expect(sessionIds.length).toBe(SESSION_COUNT);
  }, 30000);

  it('all sessions transition to active', async () => {
    const promises = sessionIds.map((id) => waitForActive(client, id, 30000));
    const results = await Promise.all(promises);

    for (const session of results) {
      expect(session.status).toBe('active');
    }
  }, 30000);

  it('all sessions appear in session_list', async () => {
    const allSessions = await client.callToolJson<SessionInfo[]>(
      'session_list',
    );

    for (const id of sessionIds) {
      const found = allSessions.find((s) => s.sessionId === id);
      expect(found, `session ${id} missing from list`).toBeDefined();
    }
  });

  it('each session has independent terminal I/O', async () => {
    // Send unique echo to each session
    const markers = sessionIds.map((id, i) => ({
      id,
      marker: `stress-${i}-${Date.now()}`,
    }));

    for (const { id, marker } of markers) {
      await client.callTool('terminal_send_keys', {
        sessionId: id,
        keys: `echo ${marker}\\r`,
      });
    }

    // Wait for all outputs
    const results = await Promise.all(
      markers.map(({ id, marker }) =>
        client.callToolText('terminal_wait_for_content', {
          sessionId: id,
          pattern: marker,
          timeout_ms: 15000,
        }),
      ),
    );

    for (let i = 0; i < markers.length; i++) {
      expect(results[i]).toContain(markers[i].marker);
    }
  }, 30000);

  it('kills all sessions and all transition to ended', async () => {
    const promises = sessionIds.map((id) => killAndWaitEnded(client, id));
    await Promise.all(promises);

    for (const id of sessionIds) {
      const session = await client.callToolJson<SessionInfo>(
        'session_get_status',
        { sessionId: id },
      );
      expect(session.status).toBe('ended');
    }
  }, 30000);

  it('tile count returns to baseline after kills', async () => {
    await waitForTileCount(client, 0);
    expect(await getTileCount(client)).toBe(0);
  });
});

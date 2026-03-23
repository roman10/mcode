import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('session delete', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let endedId1: string;
  let endedId2: string;
  let activeId: string;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    // Create 3 sessions, kill 2 to make them "ended"
    const [s1, s2, s3] = await Promise.all([
      createTestSession(client),
      createTestSession(client),
      createTestSession(client),
    ]);
    sessionIds.push(s1.sessionId, s2.sessionId, s3.sessionId);

    await Promise.all([
      waitForActive(client, s1.sessionId),
      waitForActive(client, s2.sessionId),
      waitForActive(client, s3.sessionId),
    ]);

    await killAndWaitEnded(client, s1.sessionId);
    await killAndWaitEnded(client, s2.sessionId);

    endedId1 = s1.sessionId;
    endedId2 = s2.sessionId;
    activeId = s3.sessionId;
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('deletes an ended session', async () => {
    const result = await client.callTool('session_delete', {
      sessionId: endedId1,
    });
    expect(result.isError).toBeFalsy();

    // Subsequent get should return error (not found)
    const status = await client.callTool('session_get_status', {
      sessionId: endedId1,
    });
    expect(status.isError).toBe(true);
  });

  it('rejects deleting an active session', async () => {
    const result = await client.callTool('session_delete', {
      sessionId: activeId,
    });
    expect(result.isError).toBe(true);
  });

  it('delete_all_ended removes all ended sessions', async () => {
    // endedId2 is still ended and not yet deleted
    const result = await client.callToolText('session_delete_all_ended');
    expect(result).toContain('Deleted');
    expect(result).toContain(endedId2);

    // Verify it's gone from session list
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).not.toContain(endedId2);
  });

  it('delete_all_ended is safe when no ended sessions exist', async () => {
    // All ended sessions are already deleted
    const result = await client.callToolText('session_delete_all_ended');
    expect(result).toContain('No ended sessions to delete');
  });

  describe('session_delete_batch', () => {
    it('deletes a batch of ended sessions', async () => {
      const [s1, s2] = await Promise.all([
        createTestSession(client),
        createTestSession(client),
      ]);
      sessionIds.push(s1.sessionId, s2.sessionId);
      await Promise.all([
        waitForActive(client, s1.sessionId),
        waitForActive(client, s2.sessionId),
      ]);
      await killAndWaitEnded(client, s1.sessionId);
      await killAndWaitEnded(client, s2.sessionId);

      const text = await client.callToolText('session_delete_batch', {
        sessionIds: [s1.sessionId, s2.sessionId],
      });
      expect(text).toContain('Deleted 2 session(s)');

      // Both should be gone
      const r1 = await client.callTool('session_get_status', { sessionId: s1.sessionId });
      expect(r1.isError).toBe(true);
      const r2 = await client.callTool('session_get_status', { sessionId: s2.sessionId });
      expect(r2.isError).toBe(true);
    });

    it('skips active sessions in the batch', async () => {
      const [s1, s2] = await Promise.all([
        createTestSession(client),
        createTestSession(client),
      ]);
      sessionIds.push(s1.sessionId, s2.sessionId);
      await Promise.all([
        waitForActive(client, s1.sessionId),
        waitForActive(client, s2.sessionId),
      ]);
      // Kill only s1
      await killAndWaitEnded(client, s1.sessionId);

      const text = await client.callToolText('session_delete_batch', {
        sessionIds: [s1.sessionId, s2.sessionId],
      });
      expect(text).toContain('Deleted 1 session(s)');

      // Active session should still exist
      const status = await client.callToolJson<SessionInfo>('session_get_status', {
        sessionId: s2.sessionId,
      });
      expect(status.status).toBe('active');
    });

    it('returns message for no valid IDs', async () => {
      const text = await client.callToolText('session_delete_batch', {
        sessionIds: ['nonexistent-id-1', 'nonexistent-id-2'],
      });
      expect(text).toContain('No valid ended sessions');
    });
  });
});

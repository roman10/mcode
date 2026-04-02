import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  cleanupSessions,
  createTestSession,
  killAndWaitEnded,
  resetTestState,
  type SessionInfo,
  waitForActive,
} from '../helpers';

describe('test session cleanup safety', () => {
  const client = new McpTestClient();
  const testSessionIds: string[] = [];
  const userSessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await cleanupSessions(client, testSessionIds);

    for (const sessionId of userSessionIds) {
      const status = await client.callTool('session_get_status', { sessionId });
      if (status.isError) continue;

      const session = await client.callToolJson<SessionInfo>('session_get_status', { sessionId });
      if (session.status !== 'ended') {
        await killAndWaitEnded(client, sessionId);
      }
      await client.callTool('session_delete', { sessionId });
    }

    await client.disconnect();
  });

  it('cleanupSessions only deletes ended test sessions', async () => {
    const [testSession, userSession] = await Promise.all([
      createTestSession(client),
      client.callToolJson<SessionInfo>('session_create', {
        cwd: process.cwd(),
        command: 'bash',
        label: `user-${Date.now()}`,
        sessionType: 'terminal',
        isTest: false,
      }),
    ]);
    testSessionIds.push(testSession.sessionId);
    userSessionIds.push(userSession.sessionId);

    await Promise.all([
      waitForActive(client, testSession.sessionId),
      waitForActive(client, userSession.sessionId),
    ]);

    await Promise.all([
      killAndWaitEnded(client, testSession.sessionId),
      killAndWaitEnded(client, userSession.sessionId),
    ]);

    await cleanupSessions(client, [testSession.sessionId, userSession.sessionId]);

    const deletedTest = await client.callTool('session_get_status', {
      sessionId: testSession.sessionId,
    });
    expect(deletedTest.isError).toBe(true);

    const preservedUser = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: userSession.sessionId,
    });
    expect(preservedUser.isTest).toBe(false);
    expect(preservedUser.status).toBe('ended');
  });

  it('resetTestState never deletes live non-test sessions while cleaning test sessions', async () => {
    const [testSession, userSession] = await Promise.all([
      createTestSession(client),
      client.callToolJson<SessionInfo>('session_create', {
        cwd: process.cwd(),
        command: 'bash',
        label: `user-reset-${Date.now()}`,
        sessionType: 'terminal',
        isTest: false,
      }),
    ]);
    testSessionIds.push(testSession.sessionId);
    userSessionIds.push(userSession.sessionId);

    await Promise.all([
      waitForActive(client, testSession.sessionId),
      waitForActive(client, userSession.sessionId),
    ]);

    await killAndWaitEnded(client, testSession.sessionId);
    await resetTestState(client);

    const cleanedTest = await client.callTool('session_get_status', {
      sessionId: testSession.sessionId,
    });
    if (!cleanedTest.isError) {
      const endedTest = await client.callToolJson<SessionInfo>('session_get_status', {
        sessionId: testSession.sessionId,
      });
      expect(endedTest.isTest).toBe(true);
      expect(endedTest.status).toBe('ended');
    }

    const preservedUser = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: userSession.sessionId,
    });
    expect(preservedUser.isTest).toBe(false);
    expect(['starting', 'active', 'idle', 'waiting']).toContain(preservedUser.status);
  });
});

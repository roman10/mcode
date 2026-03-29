import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createCopilotTestSession,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
  waitForIdle,
} from '../helpers';

describe('copilot resume', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterEach(async () => {
    await cleanupSessions(client, sessionIds);
    sessionIds.length = 0;
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('resumes a Copilot session after setting copilotSessionId', async () => {
    const session = await createCopilotTestSession(client, {
      label: `copilot-resume-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    // Set a copilot session ID
    const testUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await client.callToolJson<SessionInfo>('session_set_copilot_session_id', {
      sessionId: session.sessionId,
      copilotSessionId: testUuid,
    });

    // Kill the session
    await client.callToolJson('session_kill', { sessionId: session.sessionId });
    const ended = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(ended.status).toBe('ended');
    expect(ended.copilotSessionId).toBe(testUuid);

    // Resume the session
    const resumed = await client.callToolJson<SessionInfo>('session_resume', {
      sessionId: session.sessionId,
    });
    expect(resumed.status).not.toBe('ended');
    expect(resumed.copilotSessionId).toBe(testUuid);

    await waitForIdle(client, session.sessionId);
  });

  it('fails to resume without copilotSessionId', async () => {
    const session = await createCopilotTestSession(client, {
      label: `copilot-noid-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    // Kill without setting copilotSessionId
    await client.callToolJson('session_kill', { sessionId: session.sessionId });

    // Resume should fail
    const result = await client.callTool('session_resume', {
      sessionId: session.sessionId,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no Copilot session ID');
  });
});

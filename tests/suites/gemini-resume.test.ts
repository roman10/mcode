import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createGeminiTestSession,
  waitForIdle,
  killAndWaitEnded,
  cleanupSessions,
  resetTestState,
  type SessionInfo,
} from '../helpers';

describe('gemini resume', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

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
  });

  afterEach(async () => {
    await cleanupSessions(client, sessionIds);
    sessionIds.length = 0;
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('returns an error when no Gemini session ID is recorded', async () => {
    const session = await createGeminiTestSession(client, {
      label: `gemini-no-resume-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);
    await waitForIdle(client, session.sessionId);
    await waitForGeminiSessionId(session.sessionId);

    await client.callToolJson<SessionInfo>('session_set_gemini_session_id', {
      sessionId: session.sessionId,
      geminiSessionId: '',
    });

    await killAndWaitEnded(client, session.sessionId);

    const result = await client.callTool('session_resume', { sessionId: session.sessionId });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no Gemini session ID recorded');
  });

  it('resumes a Gemini session in place with the same session ID', async () => {
    const created = await createGeminiTestSession(client, {
      label: `gemini-resume-${Date.now()}`,
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(created.sessionId);

    const idle = await waitForIdle(client, created.sessionId);
    expect(idle.sessionType).toBe('gemini');
    const withGeminiId = await waitForGeminiSessionId(created.sessionId);
    expect(withGeminiId.geminiSessionId).toBe('gemini-fixture-session');

    await killAndWaitEnded(client, created.sessionId);

    const tileCountBeforeResume = Number(await client.callToolText('layout_get_tile_count'));

    const resumed = await client.callToolJson<SessionInfo>('session_resume', {
      sessionId: created.sessionId,
    });
    expect(resumed.sessionId).toBe(created.sessionId);
    expect(resumed.sessionType).toBe('gemini');

    const afterIdle = await waitForIdle(client, created.sessionId);
    expect(afterIdle.geminiSessionId).toBe('gemini-fixture-session');
    expect(afterIdle.endedAt).toBeNull();

    const tileCountAfterResume = Number(await client.callToolText('layout_get_tile_count'));
    expect(tileCountAfterResume).toBe(tileCountBeforeResume);

    const sidebarSessions = await client.callToolJson<SessionInfo[]>('sidebar_get_sessions');
    const matches = sidebarSessions.filter((session) => session.sessionId === created.sessionId);
    expect(matches).toHaveLength(1);

    const buffer = await client.callToolText('terminal_read_buffer', {
      sessionId: created.sessionId,
      lines: 50,
    });
    expect(buffer).toContain('--resume 1');
  });
});
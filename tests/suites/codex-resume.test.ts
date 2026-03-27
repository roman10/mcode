import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createCodexTestSession,
  waitForIdle,
  killAndWaitEnded,
  cleanupSessions,
  resetTestState,
  type SessionInfo,
} from '../helpers';

describe('codex resume', () => {
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

  it('returns an error when no Codex thread ID is recorded', async () => {
    const session = await createCodexTestSession(client, {
      label: `codex-no-resume-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);
    await waitForIdle(client, session.sessionId);
    await killAndWaitEnded(client, session.sessionId);

    const result = await client.callTool('session_resume', { sessionId: session.sessionId });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no Codex thread ID recorded');
  });

  it('resumes a Codex session in place with the same session ID', async () => {
    const created = await createCodexTestSession(client, {
      label: `codex-resume-${Date.now()}`,
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(created.sessionId);

    const idle = await waitForIdle(client, created.sessionId);
    expect(idle.sessionType).toBe('codex');

    const withThreadId = await client.callToolJson<SessionInfo>('session_set_codex_thread_id', {
      sessionId: created.sessionId,
      codexThreadId: 'thread-123',
    });
    expect(withThreadId.codexThreadId).toBe('thread-123');

    await killAndWaitEnded(client, created.sessionId);

    const tileCountBeforeResume = Number(await client.callToolText('layout_get_tile_count'));

    const resumed = await client.callToolJson<SessionInfo>('session_resume', {
      sessionId: created.sessionId,
    });
    expect(resumed.sessionId).toBe(created.sessionId);
    expect(resumed.sessionType).toBe('codex');

    const afterIdle = await waitForIdle(client, created.sessionId);
    expect(afterIdle.codexThreadId).toBe('thread-123');
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
    expect(buffer).toContain('resume thread-123');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  createGeminiTestSession,
  cleanupSessions,
  resetTestState,
  injectHookEvent,
  waitForIdle,
  type SessionInfo,
} from '../helpers';

describe('session model display', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('new session has null model', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    expect(session.model).toBeNull();
  });

  it('session_set_model updates model', async () => {
    const sessionId = sessionIds[0];
    const updated = await client.callToolJson<SessionInfo>('session_set_model', {
      sessionId,
      model: 'opus-4.6',
    });
    expect(updated.model).toBe('opus-4.6');
  });

  it('model persists through session_get_status', async () => {
    const sessionId = sessionIds[0];
    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.model).toBe('opus-4.6');
  });

  it('model appears in session_list', async () => {
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');
    const found = sessions.find((s) => s.sessionId === sessionIds[0]);
    expect(found).toBeDefined();
    expect(found!.model).toBe('opus-4.6');
  });

  it('model can be updated (simulates /model switch)', async () => {
    const sessionId = sessionIds[0];
    const updated = await client.callToolJson<SessionInfo>('session_set_model', {
      sessionId,
      model: 'sonnet-4.5',
    });
    expect(updated.model).toBe('sonnet-4.5');

    // Verify the update persisted
    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.model).toBe('sonnet-4.5');
  });

  it('terminal session has null model', async () => {
    const session = await createTestSession(client, { sessionType: 'terminal' });
    sessionIds.push(session.sessionId);
    expect(session.model).toBeNull();
  });

  it('Gemini session persists an explicit create-time model', async () => {
    const session = await createGeminiTestSession(client, {
      model: 'gemini-2.5-pro',
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(session.sessionId);
    expect(session.model).toBe('gemini-2.5-pro');

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.model).toBe('gemini-2.5-pro');
  });

  it('Gemini session model detected from BeforeModel hook event', async () => {
    const session = await createGeminiTestSession(client, {
      initialPrompt: 'inspect repository state',
    });
    sessionIds.push(session.sessionId);
    expect(session.model).toBeNull();

    await waitForIdle(client, session.sessionId);

    const updated = await injectHookEvent(client, session.sessionId, 'BeforeModel', {
      payload: {
        llm_request: { model: 'models/gemini-2.5-pro-preview-05-06' },
      },
    });
    expect(updated.model).toBe('gemini-2.5-pro');
  });

  it('session_set_model returns error for unknown session', async () => {
    const result = await client.callTool('session_set_model', {
      sessionId: 'nonexistent-id',
      model: 'opus-4.6',
    });
    expect(result.isError).toBe(true);
  });
});

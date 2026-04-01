import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  createCopilotTestSession,
  createGeminiTestSession,
  cleanupSessions,
  injectHookEvent,
  waitForIdle,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('session label source', () => {
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

  it('preserves user-provided label when setAutoLabel is called', async () => {
    const userLabel = `my-custom-label-${Date.now()}`;
    const session = await createTestSession(client, { label: userLabel });
    sessionIds.push(session.sessionId);

    // Terminal sessions keep the label as-is (no ✳ prefix — that's only for Claude sessions)
    const expectedLabel = session.label;
    expect(session.label).toBe(userLabel);

    // Simulate what happens when Claude Code emits its initial terminal title
    const updated = await client.callToolJson<SessionInfo>('session_set_auto_label', {
      sessionId: session.sessionId,
      label: 'Claude Code',
    });

    // Auto-label must not overwrite the user-provided (icon-prefixed) label
    expect(updated.label).toBe(expectedLabel);
  });

  it('allows auto-label to update when no user label was provided', async () => {
    // Create without an explicit label — the session gets a directory-derived label
    const session = await createTestSession(client, { label: undefined });
    sessionIds.push(session.sessionId);

    const autoTitle = `auto-title-${Date.now()}`;
    const updated = await client.callToolJson<SessionInfo>('session_set_auto_label', {
      sessionId: session.sessionId,
      label: autoTitle,
    });

    expect(updated.label).toBe(autoTitle);
  });

  it('Copilot session auto-labels from first UserPromptSubmit hook', async () => {
    // Create without a user label so label_source='auto'
    const session = await createCopilotTestSession(client, { label: undefined });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    // Inject UserPromptSubmit with a prompt — simulates Copilot's userPromptSubmitted hook
    const updated = await injectHookEvent(client, session.sessionId, 'UserPromptSubmit', {
      payload: { prompt: 'fix the authentication bug in login flow' },
    });

    // Label should be the prompt truncated and prefixed with Copilot icon (★)
    expect(updated.label).toBe('\u2605 fix the authentication bug in login flow');
  });

  it('Copilot auto-label does not overwrite user-renamed session', async () => {
    const userLabel = `my-copilot-task-${Date.now()}`;
    const session = await createCopilotTestSession(client, { label: userLabel });
    sessionIds.push(session.sessionId);

    // session.label includes the Copilot icon prefix (★) added by buildSessionLabel
    const prefixedLabel = session.label;

    await waitForIdle(client, session.sessionId);

    // UserPromptSubmit should not overwrite the user's label
    const updated = await injectHookEvent(client, session.sessionId, 'UserPromptSubmit', {
      payload: { prompt: 'refactor the database layer' },
    });

    expect(updated.label).toBe(prefixedLabel);
  });

  it('Gemini session auto-labels from first UserPromptSubmit hook', async () => {
    const session = await createGeminiTestSession(client, { label: undefined });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    const updated = await injectHookEvent(client, session.sessionId, 'UserPromptSubmit', {
      payload: { prompt: 'add unit tests for the parser module' },
    });

    // Gemini icon is ✦ (U+2726)
    expect(updated.label).toBe('\u2726 add unit tests for the parser module');
  });

  it('Copilot auto-label only applies on first prompt', async () => {
    const session = await createCopilotTestSession(client, { label: undefined });
    sessionIds.push(session.sessionId);

    await waitForIdle(client, session.sessionId);

    // First prompt sets the label
    await injectHookEvent(client, session.sessionId, 'UserPromptSubmit', {
      payload: { prompt: 'fix the auth bug' },
    });

    // Second prompt should NOT overwrite
    const updated = await injectHookEvent(client, session.sessionId, 'UserPromptSubmit', {
      payload: { prompt: 'yes' },
    });

    expect(updated.label).toBe('\u2605 fix the auth bug');
  });
});

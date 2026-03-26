import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  cleanupSessions,
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
});

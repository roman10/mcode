import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  injectHookEvent,
  getAttentionSummary,
  clearAttention,
  clearAllAttention,
  type SessionInfo,
} from '../helpers';

describe('attention system', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('PermissionRequest sets high attention', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'PermissionRequest',
      { toolName: 'Write' },
    );
    expect(updated.attentionLevel).toBe('high');
    expect(updated.status).toBe('waiting');
  });

  it('attention summary reports one high session', async () => {
    const summary = await getAttentionSummary(client);
    expect(summary.high).toBeGreaterThanOrEqual(1);
    expect(summary.dockBadge).toBeTruthy();
  });

  it('Notification sets medium attention on another session', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'Notification',
    );
    expect(updated.attentionLevel).toBe('medium');
    // Status should remain active (Notification doesn't change status)
    expect(updated.status).toBe('active');
  });

  it('Stop sets low attention on a third session', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(updated.attentionLevel).toBe('low');
    expect(updated.status).toBe('idle');
  });

  it('clear_attention clears one session without changing status', async () => {
    const sessionId = sessionIds[0]; // The one with high attention
    const updated = await clearAttention(client, sessionId);
    expect(updated.attentionLevel).toBe('none');
    expect(updated.status).toBe('waiting'); // Status unchanged
  });

  it('clear_all_attention clears all sessions', async () => {
    await clearAllAttention(client);
    const summary = await getAttentionSummary(client);
    expect(summary.high).toBe(0);
    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
  });

  it('high attention is not overridden by medium events', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Set high first
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    // Try to set medium via Notification — should stay high
    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'Notification',
    );
    expect(updated.attentionLevel).toBe('high');
  });

  it('PostToolUseFailure sets medium attention', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'PostToolUseFailure',
      { toolName: 'Bash' },
    );
    expect(updated.attentionLevel).toBe('medium');
    expect(updated.attentionReason).toContain('Bash');
  });
});

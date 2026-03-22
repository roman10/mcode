import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  injectHookEvent,
  getAttentionSummary,
  clearAttention,
  clearAllAttention,
  getSidebarSessions,
  selectSession,
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

  it('PermissionRequest sets action attention', async () => {
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
    expect(updated.attentionLevel).toBe('action');
    expect(updated.status).toBe('waiting');
  });

  it('attention summary reports one action session', async () => {
    const summary = await getAttentionSummary(client);
    expect(summary.action).toBeGreaterThanOrEqual(1);
    expect(summary.dockBadge).toBeTruthy();
  });

  it('Notification sets info attention on another session', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'Notification',
    );
    expect(updated.attentionLevel).toBe('info');
    // Status should remain active (Notification doesn't change status)
    expect(updated.status).toBe('active');
  });

  it('Stop sets action attention on a third session (no pending tasks)', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    const updated = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(updated.attentionLevel).toBe('action');
    expect(updated.status).toBe('idle');
  });

  it('clear_attention clears one session without changing status', async () => {
    const sessionId = sessionIds[0]; // The one with action attention
    const updated = await clearAttention(client, sessionId);
    expect(updated.attentionLevel).toBe('none');
    expect(updated.status).toBe('waiting'); // Status unchanged
  });

  it('clear_all_attention clears all sessions', async () => {
    await clearAllAttention(client);
    const summary = await getAttentionSummary(client);
    expect(summary.action).toBe(0);
    expect(summary.info).toBe(0);
  });

  it('action attention is not overridden by info events', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Set action first
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    // Try to set info via Notification — should stay action
    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'Notification',
    );
    expect(updated.attentionLevel).toBe('action');
  });

  it('PostToolUseFailure does not change attention', async () => {
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
    // Claude handles tool failures autonomously — no attention raised
    expect(updated.attentionLevel).toBe('none');
  });

  it('user selection clears attention for that session only', async () => {
    // Set up two sessions with attention
    const s1 = await createTestSession(client);
    const s2 = await createTestSession(client);
    sessionIds.push(s1.sessionId, s2.sessionId);
    await waitForActive(client, s1.sessionId);
    await waitForActive(client, s2.sessionId);
    await injectHookEvent(client, s1.sessionId, 'SessionStart');
    await injectHookEvent(client, s2.sessionId, 'SessionStart');
    await injectHookEvent(client, s1.sessionId, 'PermissionRequest');
    await injectHookEvent(client, s2.sessionId, 'Notification');

    // Simulate user selecting s1 via sidebar
    await selectSession(client, s1.sessionId);

    // Wait briefly for the async clearAttention call from the store
    await new Promise((r) => setTimeout(r, 500));

    // s1 attention should be cleared, s2 should still have info
    const s1Info = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s1.sessionId });
    const s2Info = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s2.sessionId });
    expect(s1Info.attentionLevel).toBe('none');
    expect(s2Info.attentionLevel).toBe('info');
  });

  it('killing a session with active attention clears it', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Set action attention
    const updated = await injectHookEvent(client, session.sessionId, 'PermissionRequest');
    expect(updated.attentionLevel).toBe('action');

    // Kill the session
    await killAndWaitEnded(client, session.sessionId);

    // Verify attention is cleared
    const ended = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(ended.status).toBe('ended');
    expect(ended.attentionLevel).toBe('none');
    expect(ended.attentionReason).toBeNull();
  });

  it('sidebar sorts sessions: action first, then info, then none', async () => {
    // Clear all attention first
    await clearAllAttention(client);

    // Create 3 sessions with different attention levels
    const sAction = await createTestSession(client);
    const sNone = await createTestSession(client);
    const sInfo = await createTestSession(client);
    sessionIds.push(sAction.sessionId, sNone.sessionId, sInfo.sessionId);

    for (const s of [sAction, sNone, sInfo]) {
      await waitForActive(client, s.sessionId);
      await injectHookEvent(client, s.sessionId, 'SessionStart');
    }

    // Set different attention levels
    await injectHookEvent(client, sInfo.sessionId, 'Notification');       // info
    await injectHookEvent(client, sAction.sessionId, 'PermissionRequest'); // action

    const sidebarSessions = await getSidebarSessions(client);
    const ids = sidebarSessions.map((s: SessionInfo) => s.sessionId);
    const actionIdx = ids.indexOf(sAction.sessionId);
    const infoIdx = ids.indexOf(sInfo.sessionId);
    const noneIdx = ids.indexOf(sNone.sessionId);

    expect(actionIdx).toBeLessThan(infoIdx);
    expect(infoIdx).toBeLessThan(noneIdx);
  });
});

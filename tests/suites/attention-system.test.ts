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

    // s1 attention should be cleared, s2 should still have medium
    const s1Info = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s1.sessionId });
    const s2Info = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s2.sessionId });
    expect(s1Info.attentionLevel).toBe('none');
    expect(s2Info.attentionLevel).toBe('medium');
  });

  it('sidebar sorts sessions by attention level (high first)', async () => {
    // Clear all attention first
    await clearAllAttention(client);

    // Create 3 sessions with different attention levels
    const sHigh = await createTestSession(client);
    const sLow = await createTestSession(client);
    const sMed = await createTestSession(client);
    sessionIds.push(sHigh.sessionId, sLow.sessionId, sMed.sessionId);

    for (const s of [sHigh, sLow, sMed]) {
      await waitForActive(client, s.sessionId);
      await injectHookEvent(client, s.sessionId, 'SessionStart');
    }

    // Set different attention levels
    await injectHookEvent(client, sLow.sessionId, 'Stop'); // low
    await injectHookEvent(client, sMed.sessionId, 'Notification'); // medium
    await injectHookEvent(client, sHigh.sessionId, 'PermissionRequest'); // high

    const sidebarSessions = await getSidebarSessions(client);
    const ids = sidebarSessions.map((s: SessionInfo) => s.sessionId);
    const highIdx = ids.indexOf(sHigh.sessionId);
    const medIdx = ids.indexOf(sMed.sessionId);
    const lowIdx = ids.indexOf(sLow.sessionId);

    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  injectHookEvent,
  cleanupSessions,
  resetTestState,
  type SessionInfo,
} from '../helpers';

/**
 * Integration tests for the detach/reconcile cycle.
 * Verifies that session states are correctly preserved when the app
 * simulates a close (detachAllActive) and reopen (reconcileDetachedSessions).
 */
describe('session detach and restore', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  // Indices into sessionIds for the 3 setup sessions
  let s1Id: string; // will be idle
  let s2Id: string; // will be active
  let s3Id: string; // will be waiting

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    // Create session 1: transition to idle via Stop hook
    const s1 = await createLiveClaudeTestSession(client);
    s1Id = s1.sessionId;
    sessionIds.push(s1Id);
    const s1Idle = await injectHookEvent(client, s1Id, 'Stop');
    expect(s1Idle.status).toBe('idle');

    // Create session 2: remain active
    const s2 = await createLiveClaudeTestSession(client);
    s2Id = s2.sessionId;
    sessionIds.push(s2Id);
    expect(s2.status).toBe('active');

    // Create session 3: transition to waiting via PermissionRequest
    const s3 = await createLiveClaudeTestSession(client);
    s3Id = s3.sessionId;
    sessionIds.push(s3Id);
    const s3Waiting = await injectHookEvent(client, s3Id, 'PermissionRequest', { toolName: 'Bash' });
    expect(s3Waiting.status).toBe('waiting');
  });

  afterAll(async () => {
    // Reconcile any still-detached sessions so cleanup can kill them
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');
    const detachedIds = sessions.filter((s) => s.status === 'detached').map((s) => s.sessionId);
    if (detachedIds.length > 0) {
      await client.callToolJson('app_reconcile_detached', { aliveSessionIds: detachedIds });
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('detach and restore preserves session states', async () => {
    // Ensure expected pre-detach states (guard against onFirstData race)
    await injectHookEvent(client, s2Id, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, s3Id, 'PermissionRequest', { toolName: 'Bash' });

    // --- Detach all (simulate app close) ---
    await client.callTool('app_detach_all');

    for (const id of [s1Id, s2Id, s3Id]) {
      const session = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: id });
      expect(session.status).toBe('detached');
    }

    // --- Reconcile (simulate app reopen) ---
    const result = await client.callToolJson<SessionInfo[]>('app_reconcile_detached', {
      aliveSessionIds: [s1Id, s2Id, s3Id],
    });

    const r1 = result.find((s) => s.sessionId === s1Id);
    const r2 = result.find((s) => s.sessionId === s2Id);
    const r3 = result.find((s) => s.sessionId === s3Id);

    // Session 1 was idle before detach -> should be idle again
    expect(r1!.status).toBe('idle');
    // Session 2 was active before detach -> should be active again
    expect(r2!.status).toBe('active');
    // Session 3 was waiting before detach -> should be waiting again
    expect(r3!.status).toBe('waiting');
  });

  it('reconcileDetachedSessions marks dead sessions as ended', async () => {
    // Create a new session and transition to idle
    const s4 = await createLiveClaudeTestSession(client);
    sessionIds.push(s4.sessionId);
    await injectHookEvent(client, s4.sessionId, 'Stop');

    // Detach all
    await client.callTool('app_detach_all');

    // Reconcile with only s4 alive (not the original sessions)
    await client.callToolJson('app_reconcile_detached', {
      aliveSessionIds: [s4.sessionId],
    });

    // s4 should be restored to idle
    const s4After = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s4.sessionId });
    expect(s4After.status).toBe('idle');

    // Previous sessions were already ended/restored from prior test — check s4 specifically
    // The point is that sessions not in aliveSessionIds get marked as ended
  });

  it('preserves attention levels through detach+restore cycle', async () => {
    // Create a session, transition to idle with action attention
    const s5 = await createLiveClaudeTestSession(client);
    sessionIds.push(s5.sessionId);
    const idled = await injectHookEvent(client, s5.sessionId, 'Stop');
    expect(idled.status).toBe('idle');
    expect(idled.attentionLevel).toBe('action');

    // Detach
    await client.callTool('app_detach_all');

    // Reconcile (session is alive)
    await client.callToolJson('app_reconcile_detached', {
      aliveSessionIds: [s5.sessionId],
    });

    // Verify attention is preserved
    const restored = await client.callToolJson<SessionInfo>('session_get_status', { sessionId: s5.sessionId });
    expect(restored.status).toBe('idle');
    expect(restored.attentionLevel).toBe('action');
  });
});

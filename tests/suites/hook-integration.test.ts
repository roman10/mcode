import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  cleanupSessions,
  injectHookEvent,
  getHookRuntime,
  getRecentEvents,
  type SessionInfo,
} from '../helpers';

describe('hook integration', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('hook runtime is ready or degraded, never initializing', async () => {
    const runtime = await getHookRuntime(client);
    expect(['ready', 'degraded']).toContain(runtime.state);
    expect(runtime.state).not.toBe('initializing');
  });

  it('SessionStart transitions to active', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'SessionStart',
      { claudeSessionId: 'claude-abc-123' },
    );
    expect(updated.status).toBe('active');
    expect(updated.claudeSessionId).toBe('claude-abc-123');
  });

  it('PreToolUse updates lastTool', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'PreToolUse', {
      toolName: 'Read',
    });
    expect(updated.lastTool).toBe('Read');
  });

  it('PostToolUse stays active', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'PostToolUse', {
      toolName: 'Read',
    });
    expect(updated.status).toBe('active');
    expect(updated.lastTool).toBe('Read');
  });

  it('Stop transitions to idle with low attention', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'Stop');
    expect(updated.status).toBe('idle');
    expect(updated.attentionLevel).toBe('low');
  });

  it('PermissionRequest transitions to waiting with high attention', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(
      client,
      sessionId,
      'PermissionRequest',
      { toolName: 'Bash' },
    );
    expect(updated.status).toBe('waiting');
    expect(updated.attentionLevel).toBe('high');
    expect(updated.attentionReason).toContain('Bash');
  });

  it('PostToolUse returns to active but attention stays high', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'PostToolUse', {
      toolName: 'Bash',
    });
    expect(updated.status).toBe('active');
    expect(updated.attentionLevel).toBe('high');
  });

  it('SessionEnd transitions to ended and clears attention', async () => {
    // Create a fresh session for this test
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await injectHookEvent(client, session.sessionId, 'SessionStart');
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    const ended = await injectHookEvent(client, session.sessionId, 'SessionEnd');
    expect(ended.status).toBe('ended');
    expect(ended.attentionLevel).toBe('none');
  });

  it('events are persisted and retrievable', async () => {
    const sessionId = sessionIds[0];
    const events = await getRecentEvents(client, sessionId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].hookEventName).toBeTruthy();
  });

  it('POST garbage to hook server returns 400 (if runtime is ready)', async () => {
    const runtime = await getHookRuntime(client);
    if (runtime.state !== 'ready' || !runtime.port) {
      return;
    }

    const res = await fetch(`http://localhost:${runtime.port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(res.status).toBe(400);
  });

  it('valid JSON but unknown event name returns 400', async () => {
    const runtime = await getHookRuntime(client);
    if (runtime.state !== 'ready' || !runtime.port) {
      return;
    }

    const res = await fetch(`http://localhost:${runtime.port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'MadeUpEvent' }),
    });
    expect(res.status).toBe(400);
  });

  it('valid event but unknown session returns 404', async () => {
    const runtime = await getHookRuntime(client);
    if (runtime.state !== 'ready' || !runtime.port) {
      return;
    }

    const res = await fetch(`http://localhost:${runtime.port}/hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mcode-Session-Id': 'nonexistent-session-id',
      },
      body: JSON.stringify({ hook_event_name: 'SessionStart' }),
    });
    expect(res.status).toBe(404);
  });

  it('Stop when already idle does not change attention', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // First Stop → idle + low
    await injectHookEvent(client, session.sessionId, 'Stop');
    const afterFirst = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(afterFirst.status).toBe('idle');
    expect(afterFirst.attentionLevel).toBe('low');

    // Clear attention manually, then Stop again when already idle
    await client.callTool('session_clear_attention', { sessionId: session.sessionId });
    const afterClear = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(afterClear.attentionLevel).toBe('none');

    // Second Stop while already idle — should not set low again
    const afterSecondStop = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(afterSecondStop.status).toBe('idle');
    expect(afterSecondStop.attentionLevel).toBe('none');
  });

  it('PTY exit transitions to ended and clears attention', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    // Set some attention via inject
    await injectHookEvent(client, session.sessionId, 'SessionStart');
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    // Kill the session (PTY exit)
    await client.callTool('session_kill', { sessionId: session.sessionId });
    const ended = await client.callToolJson<SessionInfo>('session_wait_for_status', {
      sessionId: session.sessionId,
      status: 'ended',
      timeout_ms: 15000,
    });
    expect(ended.status).toBe('ended');
    expect(ended.attentionLevel).toBe('none');
  });

  it('hook_list_recent_all returns events across sessions', async () => {
    // Earlier tests in this suite injected events into multiple sessions.
    // hook_list_recent_all should return events from across all of them.
    const events = await client.callToolJson<Array<{ sessionId: string }>>(
      'hook_list_recent_all',
    );
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });
});

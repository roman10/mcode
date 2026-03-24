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
  resetTestState,
} from '../helpers';

describe('hook integration', () => {
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

  it('Stop transitions to idle with action attention', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'Stop');
    expect(updated.status).toBe('idle');
    expect(updated.attentionLevel).toBe('action');
  });

  it('PermissionRequest transitions to waiting with action attention', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(
      client,
      sessionId,
      'PermissionRequest',
      { toolName: 'Bash' },
    );
    expect(updated.status).toBe('waiting');
    expect(updated.attentionLevel).toBe('action');
    expect(updated.attentionReason).toContain('Bash');
  });

  it('PostToolUse returns to active and clears action attention', async () => {
    const sessionId = sessionIds[0];
    const updated = await injectHookEvent(client, sessionId, 'PostToolUse', {
      toolName: 'Bash',
    });
    expect(updated.status).toBe('active');
    expect(updated.attentionLevel).toBe('none');
  });

  it('SessionEnd transitions to ended and clears attention (no claudeSessionId)', async () => {
    // Create a fresh session for this test — no claudeSessionId, so not resumable
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await injectHookEvent(client, session.sessionId, 'SessionStart');
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    const ended = await injectHookEvent(client, session.sessionId, 'SessionEnd');
    expect(ended.status).toBe('ended');
    expect(ended.attentionLevel).toBe('none');
  });

  it('SessionEnd clears attention even for resumable sessions (has claudeSessionId)', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    // Inject SessionStart with a claudeSessionId — this marks the session as resumable
    await injectHookEvent(client, session.sessionId, 'SessionStart', {
      claudeSessionId: 'claude-resume-test-123',
    });

    // Set action attention before ending
    await injectHookEvent(client, session.sessionId, 'PermissionRequest');

    const ended = await injectHookEvent(client, session.sessionId, 'SessionEnd');
    expect(ended.status).toBe('ended');
    expect(ended.attentionLevel).toBe('none');
    expect(ended.attentionReason).toBeNull();
  });

  it('events are persisted and retrievable with sessionStatus', async () => {
    const sessionId = sessionIds[0];
    const events = await getRecentEvents(client, sessionId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sessionId).toBe(sessionId);
    expect(events[0].hookEventName).toBeTruthy();
    expect(events[0].sessionStatus).toBeDefined();
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

  it('valid event but unknown session returns 200 (silently accepted)', async () => {
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
    expect(res.status).toBe(200);
  });

  it('Stop when already idle does not change attention', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // First Stop → idle + action
    await injectHookEvent(client, session.sessionId, 'Stop');
    const afterFirst = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(afterFirst.status).toBe('idle');
    expect(afterFirst.attentionLevel).toBe('action');

    // Clear attention manually, then Stop again when already idle
    await client.callTool('session_clear_attention', { sessionId: session.sessionId });
    const afterClear = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(afterClear.attentionLevel).toBe('none');

    // Second Stop while already idle — should not set action again
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

  it('sessionStatus reflects correct state after each event', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    // Inject a sequence of events and verify each resulting sessionStatus
    await injectHookEvent(client, session.sessionId, 'SessionStart');
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Read' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await injectHookEvent(client, session.sessionId, 'PermissionRequest', { toolName: 'Bash' });

    const events = await getRecentEvents(client, session.sessionId);
    // Events are DESC order: PermissionRequest, Stop, PreToolUse, SessionStart
    expect(events[0].sessionStatus).toBe('waiting');
    expect(events[1].sessionStatus).toBe('idle');
    expect(events[2].sessionStatus).toBe('active');
    expect(events[3].sessionStatus).toBe('active');
  });

  it('polling does not override hook-driven waiting status', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Send terminal data to keep lastDataAt fresh (triggers the old poll recovery condition)
    await client.callTool('terminal_send_keys', {
      sessionId: session.sessionId,
      keys: 'echo poll-test\n',
    });
    await new Promise((r) => setTimeout(r, 500));

    // Set waiting via PermissionRequest hook
    const updated = await injectHookEvent(
      client,
      session.sessionId,
      'PermissionRequest',
      { toolName: 'ExitPlanMode' },
    );
    expect(updated.status).toBe('waiting');

    // Wait for at least one poll cycle (poll runs every 2s)
    await new Promise((r) => setTimeout(r, 3000));

    // Status should still be waiting — poll should not have reset it
    const afterPoll = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(afterPoll.status).toBe('waiting');
  });

  it('Stop after ExitPlanMode transitions to waiting', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Simulate ExitPlanMode flow: PreToolUse → PostToolUse → Stop
    await injectHookEvent(client, session.sessionId, 'PreToolUse', {
      toolName: 'ExitPlanMode',
    });
    await injectHookEvent(client, session.sessionId, 'PostToolUse', {
      toolName: 'ExitPlanMode',
    });

    // Stop should transition to waiting (not idle) because last tool is ExitPlanMode
    const afterStop = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(afterStop.status).toBe('waiting');
    expect(afterStop.attentionLevel).toBe('action');
    expect(afterStop.attentionReason).toBe('Waiting for your response');
  });

  it('Stop after AskUserQuestion transitions to waiting', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    await injectHookEvent(client, session.sessionId, 'PreToolUse', {
      toolName: 'AskUserQuestion',
    });
    await injectHookEvent(client, session.sessionId, 'PostToolUse', {
      toolName: 'AskUserQuestion',
    });

    const afterStop = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(afterStop.status).toBe('waiting');
    expect(afterStop.attentionLevel).toBe('action');
    expect(afterStop.attentionReason).toBe('Waiting for your response');
  });

  it('PreToolUse after user-choice waiting transitions back to active', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    // Enter waiting via ExitPlanMode → Stop
    await injectHookEvent(client, session.sessionId, 'PreToolUse', {
      toolName: 'ExitPlanMode',
    });
    await injectHookEvent(client, session.sessionId, 'PostToolUse', {
      toolName: 'ExitPlanMode',
    });
    await injectHookEvent(client, session.sessionId, 'Stop');

    // User answers → Claude starts working again
    const resumed = await injectHookEvent(client, session.sessionId, 'PreToolUse', {
      toolName: 'Write',
    });
    expect(resumed.status).toBe('active');
    expect(resumed.attentionLevel).toBe('none');
  });

  it('Stop after normal tool still transitions to idle', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);
    await injectHookEvent(client, session.sessionId, 'SessionStart');

    await injectHookEvent(client, session.sessionId, 'PreToolUse', {
      toolName: 'Read',
    });
    await injectHookEvent(client, session.sessionId, 'PostToolUse', {
      toolName: 'Read',
    });

    const afterStop = await injectHookEvent(client, session.sessionId, 'Stop');
    expect(afterStop.status).toBe('idle');
    expect(afterStop.attentionLevel).toBe('action');
    expect(afterStop.attentionReason).toBe('Claude finished — awaiting next input');
  });

  it('hook_list_recent_all returns events with sessionStatus across sessions', async () => {
    // Earlier tests in this suite injected events into multiple sessions.
    // hook_list_recent_all should return events from across all of them.
    const events = await client.callToolJson<Array<{ sessionId: string; sessionStatus?: string }>>(
      'hook_list_recent_all',
    );
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sessionStatus).toBeDefined();
  });

  it('hook_clear_all_events removes all events', async () => {
    // Verify events exist from earlier tests
    const before = await client.callToolJson<Array<{ sessionId: string }>>(
      'hook_list_recent_all',
    );
    expect(before.length).toBeGreaterThan(0);

    // Clear all events
    await client.callTool('hook_clear_all_events');

    // Verify no events remain
    const after = await client.callToolJson<Array<{ sessionId: string }>>(
      'hook_list_recent_all',
    );
    expect(after.length).toBe(0);
  });
});

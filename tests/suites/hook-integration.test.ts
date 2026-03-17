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
  type HookRuntimeInfo,
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
      // Skip if hooks are degraded
      return;
    }

    const res = await fetch(`http://localhost:${runtime.port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(res.status).toBe(400);
  });
});

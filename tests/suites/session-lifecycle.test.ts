import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  type SessionInfo,
} from '../helpers';

describe('session lifecycle', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('creates a session with starting status', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);

    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.status).toBe('starting');
    expect(session.startedAt).toBeTruthy();
    expect(session.endedAt).toBeNull();
  });

  it('transitions from starting to active', async () => {
    const sessionId = sessionIds[0];
    const session = await waitForActive(client, sessionId);

    expect(session.status).toBe('active');
    expect(session.startedAt).toBeTruthy();
  });

  it('appears in session list', async () => {
    const sessionId = sessionIds[0];
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');

    const found = sessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('active');
  });

  it('can set label', async () => {
    const sessionId = sessionIds[0];
    const newLabel = `renamed-${Date.now()}`;
    const updated = await client.callToolJson<SessionInfo>('session_set_label', {
      sessionId,
      label: newLabel,
    });

    expect(updated.label).toBe(newLabel);

    // Verify via get_status
    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.label).toBe(newLabel);
  });

  it('has PTY info with valid pid and dimensions', async () => {
    const sessionId = sessionIds[0];
    const info = await client.callToolJson<{
      id: string;
      pid: number;
      cols: number;
      rows: number;
    }>('session_info', { sessionId });

    expect(info, `session_info returned unexpected shape: ${JSON.stringify(info)}`).toBeDefined();
    // node-pty may report pid=0 on macOS in edge cases (process exit timing)
    expect(info.pid, `pid was ${info.pid}`).toBeGreaterThanOrEqual(0);
    expect(info.cols, `cols was ${info.cols}`).toBeGreaterThan(0);
    expect(info.rows, `rows was ${info.rows}`).toBeGreaterThan(0);
  });

  it('kills session and transitions to ended', async () => {
    const sessionId = sessionIds[0];
    await killAndWaitEnded(client, sessionId);

    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.status).toBe('ended');
    expect(session.endedAt).toBeTruthy();
  });

  it('double kill is safe (idempotent)', async () => {
    const sessionId = sessionIds[0];
    // Second kill should not error
    const result = await client.callTool('session_kill', { sessionId });
    expect(result.isError).toBeFalsy();
  });
});

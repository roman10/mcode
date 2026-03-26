import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('session lifecycle', () => {
  const client = new McpTestClient();
  // sessionId/createdSession are set in beforeAll so all tests can reference them
  // without depending on test 1 having run first.
  let sessionId: string;
  let createdSession: SessionInfo;
  const extraSessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    createdSession = await createTestSession(client);
    sessionId = createdSession.sessionId;
  });

  afterAll(async () => {
    await cleanupSessions(client, [sessionId, ...extraSessionIds]);
    await client.disconnect();
  });

  it('starts with starting status', async () => {
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(createdSession.status).toBe('starting');
    expect(createdSession.startedAt).toBeTruthy();
    expect(createdSession.endedAt).toBeNull();
  });

  it('transitions from starting to active', async () => {
    const session = await waitForActive(client, sessionId);

    expect(session.status).toBe('active');
    expect(session.startedAt).toBeTruthy();
  });

  it('appears in session list', async () => {
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');

    const found = sessions.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.status).toBe('active');
  });

  it('can set label', async () => {
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
    await killAndWaitEnded(client, sessionId);

    const session = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId,
    });
    expect(session.status).toBe('ended');
    expect(session.endedAt).toBeTruthy();
  });

  it('double kill is safe (idempotent)', async () => {
    // Create a fresh session, kill it, then kill again — does not depend on above test
    const s = await createTestSession(client);
    extraSessionIds.push(s.sessionId);
    await waitForActive(client, s.sessionId);
    await killAndWaitEnded(client, s.sessionId);

    const result = await client.callTool('session_kill', { sessionId: s.sessionId });
    expect(result.isError).toBeFalsy();
  });
});

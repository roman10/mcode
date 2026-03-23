import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
} from '../helpers';

describe('ephemeral sessions', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      try { await client.callTool('layout_remove_tile', { sessionId: id }); } catch { /* best-effort */ }
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('creates an ephemeral session', async () => {
    const session = await client.callToolJson<SessionInfo>('session_create', {
      cwd: process.cwd(),
      command: 'bash',
      label: `ephemeral-${Date.now()}`,
      ephemeral: true,
      sessionType: 'terminal',
    });
    sessionIds.push(session.sessionId);

    expect(session.ephemeral).toBe(true);
    await waitForActive(client, session.sessionId);
  });

  it('ephemeral session is excluded from sidebar_get_sessions', async () => {
    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );
    const found = sidebarSessions.find(
      (s) => s.sessionId === sessionIds[0],
    );
    expect(found).toBeUndefined();
  });

  it('ephemeral session appears in session_list', async () => {
    const allSessions = await client.callToolJson<SessionInfo[]>(
      'session_list',
      { include_ephemeral: true },
    );
    const found = allSessions.find((s) => s.sessionId === sessionIds[0]);
    expect(found).toBeDefined();
    expect(found!.ephemeral).toBe(true);
  });

  it('ephemeral session has working terminal I/O', async () => {
    // Ephemeral sessions don't auto-add tiles — add one explicitly for terminal I/O
    await client.callTool('layout_add_tile', { sessionId: sessionIds[0] });

    const marker = `ephemeral-io-${Date.now()}`;
    await client.callTool('terminal_send_keys', {
      sessionId: sessionIds[0],
      keys: `echo ${marker}\\r`,
    });

    const buffer = await client.callToolText('terminal_wait_for_content', {
      sessionId: sessionIds[0],
      pattern: marker,
      timeout_ms: 10000,
    });
    expect(buffer).toContain(marker);
  });

  it('can kill an ephemeral session', async () => {
    await killAndWaitEnded(client, sessionIds[0]);

    const session = await client.callToolJson<SessionInfo>(
      'session_get_status',
      { sessionId: sessionIds[0] },
    );
    expect(session.status).toBe('ended');
  });

  it('killed ephemeral session still excluded from sidebar', async () => {
    const sidebarSessions = await client.callToolJson<SessionInfo[]>(
      'sidebar_get_sessions',
    );
    const found = sidebarSessions.find(
      (s) => s.sessionId === sessionIds[0],
    );
    expect(found).toBeUndefined();
  });
});

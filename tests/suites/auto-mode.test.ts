import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  cleanupSessions,
  type SessionInfo,
  resetTestState,
} from '../helpers';

const TEST_CLAUDE_PATH = join(process.cwd(), 'tests', 'fixtures', 'claude');

describe('enable-auto-mode flag', () => {
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

  it('session created with enableAutoMode=true stores and returns it', async () => {
    const session = await client.callToolJson<SessionInfo>('session_create', {
      cwd: process.cwd(),
      command: TEST_CLAUDE_PATH,
      label: `auto-mode-on-${Date.now()}`,
      enableAutoMode: true,
    });
    sessionIds.push(session.sessionId);

    expect(session.enableAutoMode).toBe(true);

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.enableAutoMode).toBe(true);
  });

  it('session created without enableAutoMode has it undefined', async () => {
    const session = await client.callToolJson<SessionInfo>('session_create', {
      cwd: process.cwd(),
      command: TEST_CLAUDE_PATH,
      label: `auto-mode-off-${Date.now()}`,
    });
    sessionIds.push(session.sessionId);

    expect(session.enableAutoMode).toBeUndefined();

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.enableAutoMode).toBeUndefined();
  });

  it('terminal session with enableAutoMode=true ignores it (terminal sessions do not use the flag)', async () => {
    const session = await client.callToolJson<SessionInfo>('session_create', {
      cwd: process.cwd(),
      command: 'bash',
      label: `auto-mode-terminal-${Date.now()}`,
      sessionType: 'terminal',
      enableAutoMode: true,
    });
    sessionIds.push(session.sessionId);

    // Terminal sessions never store enable_auto_mode
    expect(session.enableAutoMode).toBeUndefined();
  });
});

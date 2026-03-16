import type { McpTestClient } from './mcp-client';

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: string;
  permissionMode?: string;
  startedAt: string;
  endedAt: string | null;
}

// --- Session lifecycle helpers ---

export async function createTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: 'bash',
    label: `test-${Date.now()}`,
    ...overrides,
  });
}

export async function waitForActive(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_wait_for_status', {
    sessionId,
    status: 'active',
    timeout_ms: timeoutMs,
  });
}

export async function killAndWaitEnded(
  client: McpTestClient,
  sessionId: string,
): Promise<void> {
  await client.callTool('session_kill', { sessionId });
  await client.callToolJson('session_wait_for_status', {
    sessionId,
    status: 'ended',
    timeout_ms: 15000,
  });
}

export async function cleanupSessions(
  client: McpTestClient,
  sessionIds: string[],
): Promise<void> {
  for (const id of sessionIds) {
    try {
      await client.callTool('session_kill', { sessionId: id });
    } catch {
      // Best-effort cleanup
    }
  }
  // Give processes time to exit
  await new Promise((r) => setTimeout(r, 500));
}

// --- Layout helpers ---

export async function getTileCount(client: McpTestClient): Promise<number> {
  const text = await client.callToolText('layout_get_tile_count');
  return parseInt(text, 10);
}

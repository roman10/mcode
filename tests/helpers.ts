import type { McpTestClient } from './mcp-client';

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: string;
  permissionMode?: string;
  startedAt: string;
  endedAt: string | null;
  claudeSessionId: string | null;
  lastTool: string | null;
  lastEventAt: string | null;
  attentionLevel: string;
  attentionReason: string | null;
  hookMode: string;
  sessionType: string;
}

export interface HookRuntimeInfo {
  state: string;
  port: number | null;
  warning: string | null;
}

export interface AttentionSummary {
  high: number;
  medium: number;
  low: number;
  none: number;
  dockBadge: string;
}

export interface HookEvent {
  sessionId: string;
  claudeSessionId: string | null;
  hookEventName: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  createdAt: string;
  payload: Record<string, unknown>;
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

// --- Hook helpers ---

export async function injectHookEvent(
  client: McpTestClient,
  sessionId: string,
  hookEventName: string,
  opts?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    claudeSessionId?: string;
  },
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('hook_inject_event', {
    sessionId,
    hookEventName,
    ...opts,
  });
}

export async function waitForAttention(
  client: McpTestClient,
  sessionId: string,
  attentionLevel: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_wait_for_attention', {
    sessionId,
    attentionLevel,
    timeout_ms: timeoutMs,
  });
}

export async function getAttentionSummary(
  client: McpTestClient,
): Promise<AttentionSummary> {
  return client.callToolJson<AttentionSummary>('app_get_attention_summary');
}

export async function getHookRuntime(
  client: McpTestClient,
): Promise<HookRuntimeInfo> {
  return client.callToolJson<HookRuntimeInfo>('app_get_hook_runtime');
}

export async function getRecentEvents(
  client: McpTestClient,
  sessionId: string,
  limit?: number,
): Promise<HookEvent[]> {
  return client.callToolJson<HookEvent[]>('hook_list_recent', {
    sessionId,
    ...(limit ? { limit } : {}),
  });
}

export async function clearAttention(
  client: McpTestClient,
  sessionId: string,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_clear_attention', {
    sessionId,
  });
}

export async function clearAllAttention(
  client: McpTestClient,
): Promise<void> {
  await client.callTool('session_clear_all_attention', {});
}

// --- Sidebar helpers ---

export async function getSidebarSessions(
  client: McpTestClient,
): Promise<SessionInfo[]> {
  return client.callToolJson<SessionInfo[]>('sidebar_get_sessions');
}

export async function selectSession(
  client: McpTestClient,
  sessionId: string | null,
): Promise<void> {
  await client.callTool('sidebar_select_session', { sessionId });
}

// --- Layout helpers ---

export async function getTileCount(client: McpTestClient): Promise<number> {
  const text = await client.callToolText('layout_get_tile_count');
  return parseInt(text, 10);
}

import { join } from 'node:path';
import type { McpTestClient } from './mcp-client';

const TEST_CLAUDE_PATH = join(process.cwd(), 'tests', 'fixtures', 'claude');

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
  accountId: string | null;
}

export interface HookRuntimeInfo {
  state: string;
  port: number | null;
  warning: string | null;
}

export interface AttentionSummary {
  action: number;
  info: number;
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

// --- Test isolation ---

export async function resetTestState(client: McpTestClient): Promise<void> {
  await client.callTool('app_reset_test_state');
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
    sessionType: 'terminal',
    ...overrides,
  });
}

export async function createLiveClaudeTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  const session = await client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: TEST_CLAUDE_PATH,
    label: `live-${Date.now()}`,
    ...overrides,
  });

  if (session.hookMode !== 'live') {
    throw new Error(`Expected live hook mode, got ${session.hookMode}`);
  }

  // Inject SessionStart, then PreToolUse to ensure 'active' status.
  // onFirstData may race and transition 'starting' → 'idle' before
  // SessionStart arrives; PreToolUse reliably transitions idle → active.
  await injectHookEvent(client, session.sessionId, 'SessionStart');
  return injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
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

export async function waitForIdle(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_wait_for_status', {
    sessionId,
    status: 'idle',
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

// --- Session filter helpers ---

export async function setSessionFilter(
  client: McpTestClient,
  query: string,
): Promise<void> {
  await client.callTool('sidebar_set_session_filter', { query });
}

export async function getSessionFilter(
  client: McpTestClient,
): Promise<string> {
  const result = await client.callToolJson<{ query: string }>(
    'sidebar_get_session_filter',
  );
  return result.query;
}

// --- Task queue helpers ---

export interface TaskInfo {
  id: number;
  prompt: string;
  cwd: string;
  targetSessionId: string | null;
  sessionId: string | null;
  status: string;
  priority: number;
  scheduledAt: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  sortOrder: number | null;
}

export async function createTask(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<TaskInfo> {
  return client.callToolJson<TaskInfo>('task_create', {
    prompt: 'echo test',
    cwd: process.cwd(),
    ...overrides,
  });
}

export async function listTasks(
  client: McpTestClient,
  filter?: Record<string, unknown>,
): Promise<TaskInfo[]> {
  return client.callToolJson<TaskInfo[]>('task_list', filter ?? {});
}

export async function cancelTask(
  client: McpTestClient,
  taskId: number,
): Promise<void> {
  await client.callTool('task_cancel', { taskId });
}

export async function waitForTaskStatus(
  client: McpTestClient,
  taskId: number,
  status: string,
  timeoutMs = 30000,
): Promise<TaskInfo> {
  return client.callToolJson<TaskInfo>('task_wait_for_status', {
    taskId,
    status,
    timeout_ms: timeoutMs,
  });
}

// --- Layout helpers ---

export async function getTileCount(client: McpTestClient): Promise<number> {
  const text = await client.callToolText('layout_get_tile_count');
  return parseInt(text, 10);
}

export async function waitForTileCount(
  client: McpTestClient,
  expected: number,
  timeoutMs = 10000,
): Promise<number> {
  const text = await client.callToolText('layout_wait_for_tile_count', {
    expected,
    timeout_ms: timeoutMs,
  });
  return parseInt(text, 10);
}

export async function waitForViewMode(
  client: McpTestClient,
  expected: 'tiles' | 'kanban',
  timeoutMs = 10000,
): Promise<string> {
  const text = await client.callToolText('layout_wait_for_view_mode', {
    expected,
    timeout_ms: timeoutMs,
  });
  return text.replace('View mode: ', '').trim();
}

// --- Kanban helpers ---

export interface KanbanColumnEntry {
  sessionId: string;
  label: string;
  status: string;
  attentionLevel: string;
}

export interface KanbanState {
  expandedSessionId: string | null;
  columns: Record<string, KanbanColumnEntry[]>;
}

export async function getViewMode(client: McpTestClient): Promise<string> {
  const text = await client.callToolText('layout_get_view_mode');
  // Response is "View mode: tiles" or "View mode: kanban"
  return text.replace('View mode: ', '').trim();
}

export async function setViewMode(
  client: McpTestClient,
  mode: 'tiles' | 'kanban',
): Promise<void> {
  await client.callTool('layout_set_view_mode', { mode });
}

export async function getKanbanState(client: McpTestClient): Promise<KanbanState> {
  return client.callToolJson<KanbanState>('kanban_get_columns');
}

export async function expandKanbanSession(
  client: McpTestClient,
  sessionId: string,
): Promise<void> {
  await client.callTool('kanban_expand_session', { sessionId });
}

export async function collapseKanban(client: McpTestClient): Promise<void> {
  await client.callTool('kanban_collapse');
}

export async function waitForKanbanColumn(
  client: McpTestClient,
  sessionId: string,
  column: string,
  timeoutMs = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const state = await getKanbanState(client);
    if (state.columns[column]?.some((s) => s.sessionId === sessionId)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for session ${sessionId} in column "${column}"`);
}

export async function waitForKanbanCollapse(
  client: McpTestClient,
  timeoutMs = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const state = await getKanbanState(client);
    if (state.expandedSessionId === null) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timeout waiting for kanban expansion to collapse');
}

// --- File helpers ---

export async function writeTestFile(
  client: McpTestClient,
  relativePath: string,
  content: string,
  cwd?: string,
): Promise<string> {
  return client.callToolText('file_write', {
    cwd: cwd ?? process.cwd(),
    relativePath,
    content,
  });
}

// --- Sidebar tab helpers ---

export async function getSidebarActiveTab(client: McpTestClient): Promise<string> {
  const text = await client.callToolText('sidebar_get_active_tab');
  return text.replace('Active sidebar tab: ', '').trim();
}

export async function switchSidebarTab(
  client: McpTestClient,
  tab: 'sessions' | 'search' | 'changes' | 'stats' | 'activity',
): Promise<string> {
  return client.callToolText('sidebar_switch_tab', { tab });
}

// --- Task update helper ---

export async function updateTask(
  client: McpTestClient,
  taskId: number,
  updates: { prompt?: string; priority?: number; scheduledAt?: string | null },
): Promise<TaskInfo> {
  return client.callToolJson<TaskInfo>('task_update', { taskId, ...updates });
}

export async function reorderTask(
  client: McpTestClient,
  taskId: number,
  direction: 'up' | 'down',
): Promise<TaskInfo> {
  return client.callToolJson<TaskInfo>('task_reorder', { taskId, direction });
}

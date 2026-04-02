import { join } from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { McpTestClient } from './mcp-client';

const TEST_CLAUDE_PATH = join(process.cwd(), 'tests', 'fixtures', 'claude');
const TEST_CODEX_PATH = join(process.cwd(), 'tests', 'fixtures', 'codex');
const TEST_GEMINI_PATH = join(process.cwd(), 'tests', 'fixtures', 'gemini');
const TEST_COPILOT_PATH = join(process.cwd(), 'tests', 'fixtures', 'copilot');

export interface SessionInfo {
  sessionId: string;
  label: string;
  cwd: string;
  status: string;
  permissionMode?: string;
  effort?: string;
  enableAutoMode?: boolean;
  allowBypassPermissions?: boolean;
  startedAt: string;
  endedAt: string | null;
  claudeSessionId: string | null;
  codexThreadId: string | null;
  geminiSessionId: string | null;
  copilotSessionId: string | null;
  lastTool: string | null;
  lastEventAt: string | null;
  attentionLevel: string;
  attentionReason: string | null;
  hookMode: string;
  sessionType: string;
  worktree: string | null;
  terminalConfig?: Record<string, unknown>;
  accountId: string | null;
  autoClose?: boolean;
  model: string | null;
  isTest: boolean;
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

// --- Timing utilities ---

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  timeoutMessage: string,
  intervalMs = 250,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(timeoutMessage);
}

/**
 * Wait for a condition in the renderer using window_execute_js and polling.
 */
export async function waitForRenderer(
  client: McpTestClient,
  predicateJs: string,
  timeoutMs = 10000,
): Promise<void> {
  await pollUntil(
    async () => {
      const result = await client.callToolJson<boolean>('window_execute_js', {
        code: `(Boolean(${predicateJs}))`,
      });
      return result === true;
    },
    timeoutMs,
    `Timeout waiting for renderer state: ${predicateJs}`,
  );
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
    isTest: true,
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
    isTest: true,
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

export async function createCodexTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: TEST_CODEX_PATH,
    label: `codex-${Date.now()}`,
    sessionType: 'codex',
    isTest: true,
    ...overrides,
  });
}

export async function createGeminiTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: TEST_GEMINI_PATH,
    label: `gemini-${Date.now()}`,
    sessionType: 'gemini',
    isTest: true,
    ...overrides,
  });
}

export async function createCopilotTestSession(
  client: McpTestClient,
  overrides?: Record<string, unknown>,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_create', {
    cwd: process.cwd(),
    command: TEST_COPILOT_PATH,
    label: `copilot-${Date.now()}`,
    sessionType: 'copilot',
    isTest: true,
    ...overrides,
  });
}

export async function waitForSessionStatus(
  client: McpTestClient,
  sessionId: string,
  status: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_wait_for_status', {
    sessionId,
    status,
    timeout_ms: timeoutMs,
  });
}

export async function waitForActive(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return waitForSessionStatus(client, sessionId, 'active', timeoutMs);
}

export async function waitForIdle(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return waitForSessionStatus(client, sessionId, 'idle', timeoutMs);
}

export async function waitForAttentionCleared(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 15000,
): Promise<SessionInfo> {
  return client.callToolJson<SessionInfo>('session_wait_for_attention', {
    sessionId,
    attentionLevel: 'none',
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
  if (sessionIds.length === 0) return;
  const sessions = await client.callToolJson<SessionInfo[]>('session_list');
  const testSessionIds = sessionIds.filter((id) =>
    sessions.some((session) => session.sessionId === id && session.isTest),
  );
  if (testSessionIds.length === 0) return;
  // Remove mosaic tiles before killing (best-effort; no-op for terminal sessions or already-removed tiles)
  await Promise.allSettled(
    testSessionIds.map((id) => client.callTool('layout_remove_tile', { sessionId: id })),
  );
  // Remove bottom-panel terminal tabs (best-effort; no-op for non-terminal sessions)
  await Promise.allSettled(
    testSessionIds.map((id) => client.callTool('terminal_panel_remove_tab', { sessionId: id })),
  );
  // Kill all concurrently
  await Promise.allSettled(
    testSessionIds.map((id) => client.callTool('session_kill', { sessionId: id })),
  );
  // Wait for each to reach 'ended' concurrently with a short timeout
  await Promise.allSettled(
    testSessionIds.map((id) =>
      client.callToolJson('session_wait_for_status', {
        sessionId: id,
        status: 'ended',
        timeout_ms: 5000,
      }),
    ),
  );
  const endedTestIds = (await client.callToolJson<SessionInfo[]>('session_list'))
    .filter((session) => testSessionIds.includes(session.sessionId) && session.status === 'ended')
    .map((session) => session.sessionId);
  if (endedTestIds.length === 0) return;
  // Delete only the ended test sessions from DB
  await client.callTool('session_delete_batch', { sessionIds: endedTestIds });
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
    payload?: Record<string, unknown>;
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

export async function waitForSidebarSession(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 10000,
): Promise<SessionInfo> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sessions = await client.callToolJson<SessionInfo[]>('sidebar_get_sessions');
    const found = sessions.find((s) => s.sessionId === sessionId);
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for sidebar session ${sessionId}`);
}

export async function waitForKanbanSession(
  client: McpTestClient,
  sessionId: string,
  timeoutMs = 10000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const kanban = await client.callToolJson<KanbanState>('kanban_get_columns');
    for (const [column, sessions] of Object.entries(kanban.columns)) {
      if (sessions.some((s) => s.sessionId === sessionId)) {
        return column;
      }
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for kanban session ${sessionId}`);
}

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

export async function getSidebarSelected(
  client: McpTestClient,
): Promise<{ selectedSessionId: string | null }> {
  return client.callToolJson<{ selectedSessionId: string | null }>('sidebar_get_selected');
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
  await pollUntil(
    async () => {
      const state = await getKanbanState(client);
      return state.columns[column]?.some((s) => s.sessionId === sessionId) ?? false;
    },
    timeoutMs,
    `Timeout waiting for session ${sessionId} in column "${column}"`,
  );
}

export async function waitForKanbanCollapse(
  client: McpTestClient,
  timeoutMs = 10000,
): Promise<void> {
  await pollUntil(
    async () => {
      const state = await getKanbanState(client);
      return state.expandedSessionId === null;
    },
    timeoutMs,
    'Timeout waiting for kanban expansion to collapse',
  );
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

// --- Shared agent task queue test suite ---

/**
 * Create a live agent session and transition it to idle via hook injection.
 *
 * Note: 'Stop' is a synthetic test event injected via the canonical mcode event
 * name. In production, some agents reach idle via quiescence polling rather than
 * a Stop hook event. Using 'Stop' here is correct for testing because
 * injectHookEvent sends directly to the session-manager state machine.
 */
export async function createIdleLiveAgentSession(
  client: McpTestClient,
  createSession: (client: McpTestClient, overrides?: Record<string, unknown>) => Promise<SessionInfo>,
  agentLabel: string,
): Promise<SessionInfo> {
  const session = await createSession(client);
  if (session.hookMode !== 'live') {
    throw new Error(
      `Expected ${agentLabel} session to have hookMode='live', got '${session.hookMode}'. ` +
      `Ensure the dev instance has the ${agentLabel} hook bridge configured.`,
    );
  }

  await injectHookEvent(client, session.sessionId, 'SessionStart');
  return injectHookEvent(client, session.sessionId, 'Stop');
}

/**
 * Generate the standard agent task queue integration test suite.
 *
 * Tests the six behaviors common to all non-Claude agents with task queue
 * support: dispatch, sequential dispatch, permission-mode rejection,
 * plan-mode rejection, fallback-mode rejection, and session-end failure.
 */
export function describeAgentTaskQueue(
  agentLabel: string,
  createSession: (client: McpTestClient, overrides?: Record<string, unknown>) => Promise<SessionInfo>,
): void {
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

  async function createIdleLive(): Promise<SessionInfo> {
    return createIdleLiveAgentSession(client, createSession, agentLabel);
  }

  it(`dispatches a task to a live ${agentLabel} session`, async () => {
    const session = await createIdleLive();
    sessionIds.push(session.sessionId);
    expect(session.hookMode).toBe('live');
    expect(session.status).toBe('idle');

    const task = await createTask(client, {
      prompt: 'inspect tests',
      targetSessionId: session.sessionId,
    });

    const dispatched = await waitForTaskStatus(client, task.id, 'dispatched', 10000);
    expect(dispatched.sessionId).toBe(session.sessionId);

    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');

    const completed = await waitForTaskStatus(client, task.id, 'completed', 10000);
    expect(completed.completedAt).not.toBeNull();

    await killAndWaitEnded(client, session.sessionId);
  });

  it(`dispatches tasks sequentially on a ${agentLabel} session`, async () => {
    const session = await createIdleLive();
    sessionIds.push(session.sessionId);

    const t1 = await createTask(client, { prompt: 'task 1', targetSessionId: session.sessionId });
    const t2 = await createTask(client, { prompt: 'task 2', targetSessionId: session.sessionId });

    await waitForTaskStatus(client, t1.id, 'dispatched', 10000);

    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, t1.id, 'completed', 10000);

    await waitForTaskStatus(client, t2.id, 'dispatched', 10000);

    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, t2.id, 'completed', 10000);

    await killAndWaitEnded(client, session.sessionId);
  });

  it(`rejects permission-mode tasks for ${agentLabel} sessions`, async () => {
    const session = await createIdleLive();
    sessionIds.push(session.sessionId);

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
        permissionMode: 'auto',
      }),
    ).rejects.toThrow(/permission mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it(`rejects plan-mode tasks for ${agentLabel} sessions`, async () => {
    const session = await createIdleLive();
    sessionIds.push(session.sessionId);

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
        planModeAction: { exitPlanMode: false },
      }),
    ).rejects.toThrow(/plan mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it(`rejects task targeting a fallback ${agentLabel} session`, async () => {
    const session = await createSession(client, { command: 'bash' });
    sessionIds.push(session.sessionId);
    await waitForIdle(client, session.sessionId);
    expect(session.hookMode).toBe('fallback');

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
      }),
    ).rejects.toThrow(/live hook mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it(`fails ${agentLabel} tasks when session ends`, async () => {
    const session = await createIdleLive();
    sessionIds.push(session.sessionId);

    const t1 = await createTask(client, { prompt: 'task 1', targetSessionId: session.sessionId });
    const t2 = await createTask(client, { prompt: 'task 2', targetSessionId: session.sessionId });

    await waitForTaskStatus(client, t1.id, 'dispatched', 10000);

    await killAndWaitEnded(client, session.sessionId);

    const failed1 = await waitForTaskStatus(client, t1.id, 'failed', 10000);
    expect(failed1.error).toBeTruthy();

    const failed2 = await waitForTaskStatus(client, t2.id, 'failed', 10000);
    expect(failed2.error).toBeTruthy();
  });
}

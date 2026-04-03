import type { SessionInfo, CommitGraphNode, HookRuntimeInfo, Task } from '../../src/shared/types';
import type { AccountProfile } from '../../src/main/accounts/account-profile-repository';
import type { AccountIdentityRow } from '../../src/main/accounts/account-identity-repository';

/**
 * Create a minimal SessionInfo with sensible defaults, overridable per-field.
 * Defaults isTest to true for unit tests.
 */
export function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'test-session-1',
    label: 'Test Session',
    cwd: '/tmp/test',
    status: 'active',
    worktree: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    claudeSessionId: null,
    codexThreadId: null,
    geminiSessionId: null,
    copilotSessionId: null,
    lastTool: null,
    lastEventAt: null,
    attentionLevel: 'none',
    attentionReason: null,
    hookMode: 'live',
    sessionType: 'claude',
    terminalConfig: {},
    accountId: null,
    autoClose: false,
    model: null,
    isTest: true,
    ...overrides,
  };
}

/**
 * Create a minimal CommitGraphNode with sensible defaults, overridable per-field.
 */
export function makeCommitNode(overrides: Partial<CommitGraphNode> = {}): CommitGraphNode {
  return {
    hash: 'abc1234567890',
    shortHash: 'abc1234',
    parents: [],
    message: 'test commit',
    authorName: 'Test',
    authorEmail: 'test@example.com',
    committedAt: new Date().toISOString(),
    refs: [],
    isClaudeAssisted: false,
    filesChanged: null,
    insertions: null,
    deletions: null,
    ...overrides,
  };
}

/**
 * Create a minimal Task with sensible defaults.
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    prompt: 'test task',
    cwd: '/tmp',
    targetSessionId: null,
    sessionId: null,
    status: 'pending',
    priority: 0,
    maxRetries: 3,
    retryCount: 0,
    error: null,
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    dispatchedAt: null,
    completedAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

/**
 * Create a minimal AccountProfile with sensible defaults.
 */
export function makeAccountProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    accountId: 'test-account-id',
    name: 'Test Account',
    isDefault: false,
    homeDir: '/tmp/test-home',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    ...overrides,
  };
}

/**
 * Create a minimal AccountIdentityRow with sensible defaults.
 */
export function makeAccountIdentity(overrides: Partial<AccountIdentityRow> = {}): AccountIdentityRow {
  return {
    accountId: 'test-account-id',
    sessionType: 'claude',
    authStatus: 'ok',
    identity: 'test@example.com',
    displayName: 'Test User',
    lastCheckedAt: new Date().toISOString(),
    lastAuthenticatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a minimal HookRuntimeInfo with sensible defaults.
 */
export function makeHookRuntime(overrides: Partial<HookRuntimeInfo> = {}): HookRuntimeInfo {
  return {
    state: 'ready',
    port: 4312,
    warning: null,
    ...overrides,
  };
}

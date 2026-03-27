import type { SessionInfo, CommitGraphNode } from '../../src/shared/types';

/**
 * Create a minimal SessionInfo with sensible defaults, overridable per-field.
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

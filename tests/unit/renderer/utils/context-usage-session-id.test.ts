import { describe, expect, it } from 'vitest';
import { getContextUsageAgentSessionId } from '../../../../src/renderer/utils/context-usage-session-id';

describe('getContextUsageAgentSessionId', () => {
  it('uses Claude session ids for Claude sessions', () => {
    expect(getContextUsageAgentSessionId({
      sessionType: 'claude',
      claudeSessionId: 'claude-123',
      codexThreadId: 'codex-ignored',
    })).toBe('claude-123');
  });

  it('uses Codex thread ids for Codex sessions', () => {
    expect(getContextUsageAgentSessionId({
      sessionType: 'codex',
      claudeSessionId: 'claude-ignored',
      codexThreadId: 'codex-123',
    })).toBe('codex-123');
  });

  it('returns null for sessions without supported context accounting', () => {
    expect(getContextUsageAgentSessionId({
      sessionType: 'terminal',
      claudeSessionId: null,
      codexThreadId: null,
    })).toBeNull();
  });
});

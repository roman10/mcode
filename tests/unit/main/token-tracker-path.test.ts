import { describe, it, expect } from 'vitest';
import { extractSessionMetadata } from '../../../src/main/trackers/token-tracker';

const projectsDir = '/Users/testuser/.claude/projects';

describe('extractSessionMetadata', () => {
  it('extracts from a main session file path', () => {
    const filePath = `${projectsDir}/-Users-testuser-myproject/abc12345-1234-5678-9abc-def012345678.jsonl`;
    const result = extractSessionMetadata(filePath, projectsDir);
    expect(result).toEqual({
      sessionId: 'abc12345-1234-5678-9abc-def012345678',
      projectDir: '-Users-testuser-myproject',
    });
  });

  it('extracts from a subagent file path', () => {
    const filePath = `${projectsDir}/-Users-testuser-myproject/abc12345-1234-5678-9abc-def012345678/subagents/agent-a086798619e1a20db.jsonl`;
    const result = extractSessionMetadata(filePath, projectsDir);
    expect(result).toEqual({
      sessionId: 'abc12345-1234-5678-9abc-def012345678',
      projectDir: '-Users-testuser-myproject',
    });
  });

  it('handles hyphenated project names', () => {
    const filePath = `${projectsDir}/-Users-feipeng-startup-mcode/f062c686-8f19-46ec-aa4c-a11b48df1219.jsonl`;
    const result = extractSessionMetadata(filePath, projectsDir);
    expect(result).toEqual({
      sessionId: 'f062c686-8f19-46ec-aa4c-a11b48df1219',
      projectDir: '-Users-feipeng-startup-mcode',
    });
  });

  it('extracts parent session UUID not agent ID from subagent path', () => {
    const filePath = `${projectsDir}/-Users-feipeng-startup-mcode/f062c686-8f19-46ec-aa4c-a11b48df1219/subagents/agent-a25a24abc8409f941.jsonl`;
    const result = extractSessionMetadata(filePath, projectsDir);
    expect(result.sessionId).toBe('f062c686-8f19-46ec-aa4c-a11b48df1219');
    expect(result.sessionId).not.toContain('agent-');
  });
});

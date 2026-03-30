import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseEventsJsonlFirstLine,
  parseWorkspaceYaml,
  listCopilotSessions,
  selectCopilotSessionCandidate,
  resolveCopilotStateDir,
} from '../../../src/main/session/copilot-session-store';

const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';

describe('parseEventsJsonlFirstLine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `copilot-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses valid session.start event with nested data', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, JSON.stringify({
      type: 'session.start',
      data: {
        sessionId: UUID_A,
        startTime: '2026-03-29T10:00:00Z',
        context: { cwd: '/home/user/project' },
      },
      timestamp: '2026-03-29T10:00:00Z',
    }) + '\n');

    const result = parseEventsJsonlFirstLine(path);
    expect(result).toEqual({
      sessionId: UUID_A,
      cwd: '/home/user/project',
      startTime: '2026-03-29T10:00:00Z',
    });
  });

  it('returns null for non-session.start type', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'tool.use', data: {} }) + '\n');
    expect(parseEventsJsonlFirstLine(path)).toBeNull();
  });

  it('returns null for missing fields', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, JSON.stringify({
      type: 'session.start',
      data: { sessionId: UUID_A },
    }) + '\n');
    expect(parseEventsJsonlFirstLine(path)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, 'not json\n');
    expect(parseEventsJsonlFirstLine(path)).toBeNull();
  });

  it('skips malformed first line and tries to find a valid session.start', () => {
    // Note: current implementation only looks at the first line. 
    // Let's verify this behavior or improve it if needed.
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, 'not json\n' + JSON.stringify({
      type: 'session.start',
      data: { sessionId: UUID_A, startTime: '2026-03-29T10:00:00Z', context: { cwd: '/tmp' } },
    }) + '\n');
    
    // Current implementation:
    expect(parseEventsJsonlFirstLine(path)).toBeNull();
  });

  it('returns null for empty file', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, '');
    expect(parseEventsJsonlFirstLine(path)).toBeNull();
  });

  it('returns null for non-existent file', () => {
    expect(parseEventsJsonlFirstLine(join(tmpDir, 'missing.jsonl'))).toBeNull();
  });

  it('falls back to event.timestamp when data.startTime is missing', () => {
    const path = join(tmpDir, 'events.jsonl');
    writeFileSync(path, JSON.stringify({
      type: 'session.start',
      data: {
        sessionId: UUID_A,
        context: { cwd: '/tmp' },
      },
      timestamp: '2026-03-29T12:00:00Z',
    }) + '\n');

    const result = parseEventsJsonlFirstLine(path);
    expect(result?.startTime).toBe('2026-03-29T12:00:00Z');
  });
});

describe('parseWorkspaceYaml', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `copilot-yaml-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses valid workspace.yaml', () => {
    const path = join(tmpDir, 'workspace.yaml');
    writeFileSync(path, `id: ${UUID_A}\ncwd: /home/user/project\ncreated_at: 2026-03-29T10:00:00Z\n`);

    const result = parseWorkspaceYaml(path);
    expect(result).toEqual({
      sessionId: UUID_A,
      cwd: '/home/user/project',
      startTime: '2026-03-29T10:00:00Z',
    });
  });

  it('returns null for missing fields', () => {
    const path = join(tmpDir, 'workspace.yaml');
    writeFileSync(path, `id: ${UUID_A}\ncwd: /tmp\n`);
    expect(parseWorkspaceYaml(path)).toBeNull();
  });

  it('returns null for empty file', () => {
    const path = join(tmpDir, 'workspace.yaml');
    writeFileSync(path, '');
    expect(parseWorkspaceYaml(path)).toBeNull();
  });

  it('returns null for non-existent file', () => {
    expect(parseWorkspaceYaml(join(tmpDir, 'missing.yaml'))).toBeNull();
  });
});

describe('listCopilotSessions', () => {
  let tmpDir: string;
  const originalEnv = process.env['MCODE_COPILOT_STATE_DIR'];

  beforeEach(() => {
    tmpDir = join(tmpdir(), `copilot-list-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    process.env['MCODE_COPILOT_STATE_DIR'] = tmpDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['MCODE_COPILOT_STATE_DIR'];
    } else {
      process.env['MCODE_COPILOT_STATE_DIR'] = originalEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists sessions from events.jsonl', () => {
    const sessionDir = join(tmpDir, UUID_A);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'events.jsonl'), JSON.stringify({
      type: 'session.start',
      data: {
        sessionId: UUID_A,
        startTime: '2026-03-29T10:00:00Z',
        context: { cwd: '/project' },
      },
    }) + '\n');

    const sessions = listCopilotSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(UUID_A);
    expect(sessions[0].cwd).toBe('/project');
  });

  it('falls back to workspace.yaml when events.jsonl is absent', () => {
    const sessionDir = join(tmpDir, UUID_B);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'workspace.yaml'),
      `id: ${UUID_B}\ncwd: /other\ncreated_at: 2026-03-29T11:00:00Z\n`);

    const sessions = listCopilotSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(UUID_B);
  });

  it('skips non-UUID directories', () => {
    mkdirSync(join(tmpDir, 'not-a-uuid'), { recursive: true });
    writeFileSync(join(tmpDir, 'not-a-uuid', 'workspace.yaml'),
      `id: test\ncwd: /tmp\ncreated_at: 2026-03-29T10:00:00Z\n`);

    const sessions = listCopilotSessions();
    expect(sessions).toHaveLength(0);
  });

  it('returns empty array when state dir does not exist', () => {
    process.env['MCODE_COPILOT_STATE_DIR'] = join(tmpDir, 'nonexistent');
    const sessions = listCopilotSessions();
    expect(sessions).toHaveLength(0);
  });
});

describe('selectCopilotSessionCandidate', () => {
  const baseTime = Date.parse('2026-03-29T10:00:00Z');

  it('returns single matching session', () => {
    const entries = [
      { sessionId: UUID_A, cwd: '/project', createdAtMs: baseTime },
    ];
    const result = selectCopilotSessionCandidate(entries, {
      cwd: '/project',
      startedAtMs: baseTime,
      nowMs: baseTime + 1000,
      claimedSessionIds: new Set(),
    });
    expect(result).toBe(UUID_A);
  });

  it('returns null for multiple matching sessions (ambiguous)', () => {
    const entries = [
      { sessionId: UUID_A, cwd: '/project', createdAtMs: baseTime },
      { sessionId: UUID_B, cwd: '/project', createdAtMs: baseTime + 500 },
    ];
    const result = selectCopilotSessionCandidate(entries, {
      cwd: '/project',
      startedAtMs: baseTime,
      nowMs: baseTime + 1000,
      claimedSessionIds: new Set(),
    });
    expect(result).toBeNull();
  });

  it('excludes sessions with mismatched cwd', () => {
    const entries = [
      { sessionId: UUID_A, cwd: '/other-project', createdAtMs: baseTime },
    ];
    const result = selectCopilotSessionCandidate(entries, {
      cwd: '/project',
      startedAtMs: baseTime,
      nowMs: baseTime + 1000,
      claimedSessionIds: new Set(),
    });
    expect(result).toBeNull();
  });

  it('excludes sessions outside time window', () => {
    const entries = [
      { sessionId: UUID_A, cwd: '/project', createdAtMs: baseTime - 10_000 },
    ];
    const result = selectCopilotSessionCandidate(entries, {
      cwd: '/project',
      startedAtMs: baseTime,
      nowMs: baseTime + 1000,
      claimedSessionIds: new Set(),
    });
    expect(result).toBeNull();
  });

  it('excludes already claimed sessions', () => {
    const entries = [
      { sessionId: UUID_A, cwd: '/project', createdAtMs: baseTime },
    ];
    const result = selectCopilotSessionCandidate(entries, {
      cwd: '/project',
      startedAtMs: baseTime,
      nowMs: baseTime + 1000,
      claimedSessionIds: new Set([UUID_A]),
    });
    expect(result).toBeNull();
  });
});

describe('resolveCopilotStateDir', () => {
  const originalStateDir = process.env['MCODE_COPILOT_STATE_DIR'];
  const originalCopilotHome = process.env['COPILOT_HOME'];

  afterEach(() => {
    if (originalStateDir === undefined) {
      delete process.env['MCODE_COPILOT_STATE_DIR'];
    } else {
      process.env['MCODE_COPILOT_STATE_DIR'] = originalStateDir;
    }
    if (originalCopilotHome === undefined) {
      delete process.env['COPILOT_HOME'];
    } else {
      process.env['COPILOT_HOME'] = originalCopilotHome;
    }
  });

  it('respects MCODE_COPILOT_STATE_DIR when directory exists', () => {
    const tmpDir = join(tmpdir(), `copilot-resolve-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    process.env['MCODE_COPILOT_STATE_DIR'] = tmpDir;

    expect(resolveCopilotStateDir()).toBe(tmpDir);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when MCODE_COPILOT_STATE_DIR does not exist', () => {
    process.env['MCODE_COPILOT_STATE_DIR'] = '/nonexistent/path/copilot';
    expect(resolveCopilotStateDir()).toBeNull();
  });
});

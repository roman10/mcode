import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CopilotSessionEntry {
  sessionId: string;
  cwd: string;
  createdAtMs: number;
}

export interface CopilotSessionMatchInput {
  cwd: string;
  startedAtMs: number;
  nowMs: number;
  claimedSessionIds: Set<string>;
}

/**
 * Resolve the Copilot session-state directory.
 * Respects MCODE_COPILOT_STATE_DIR env override for testing.
 */
export function resolveCopilotStateDir(): string | null {
  const directPath = process.env['MCODE_COPILOT_STATE_DIR'];
  if (directPath) return existsSync(directPath) ? directPath : null;

  const copilotHome = process.env['COPILOT_HOME'] ?? join(homedir(), '.copilot');
  const stateDir = join(copilotHome, 'session-state');
  return existsSync(stateDir) ? stateDir : null;
}

/**
 * Parse the first line of events.jsonl to extract session metadata.
 *
 * Verified against Copilot CLI v1.0.12: the first event is always
 * `session.start` with fields nested under `data` (camelCase).
 */
export function parseEventsJsonlFirstLine(
  eventsPath: string,
): { sessionId: string; cwd: string; startTime: string } | null {
  try {
    const content = readFileSync(eventsPath, 'utf8');
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return null;

    const event = JSON.parse(firstLine);
    if (event.type !== 'session.start') return null;

    const data = event.data;
    if (!data) return null;

    const sessionId = data.sessionId;
    const cwd = data.context?.cwd;
    const startTime = data.startTime ?? event.timestamp;

    if (!sessionId || !cwd || !startTime) return null;
    return { sessionId, cwd, startTime };
  } catch {
    return null;
  }
}

/**
 * Parse workspace.yaml to extract session metadata.
 *
 * Fallback for sessions that don't have events.jsonl.
 * Uses simple line-based parsing to avoid a YAML parser dependency.
 */
export function parseWorkspaceYaml(
  yamlPath: string,
): { sessionId: string; cwd: string; startTime: string } | null {
  try {
    const content = readFileSync(yamlPath, 'utf8');
    const fields: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) fields[match[1]] = match[2].trim();
    }

    const sessionId = fields['id'];
    const cwd = fields['cwd'];
    const startTime = fields['created_at'];

    if (!sessionId || !cwd || !startTime) return null;
    return { sessionId, cwd, startTime };
  } catch {
    return null;
  }
}

/**
 * List all Copilot sessions from the state directory.
 *
 * Tries events.jsonl first (richer data), falls back to workspace.yaml.
 */
export function listCopilotSessions(): CopilotSessionEntry[] {
  const stateDir = resolveCopilotStateDir();
  if (!stateDir) return [];

  const entries: CopilotSessionEntry[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(stateDir);
  } catch {
    return [];
  }

  for (const dirname of dirs) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dirname)) continue;

    const eventsPath = join(stateDir, dirname, 'events.jsonl');
    const yamlPath = join(stateDir, dirname, 'workspace.yaml');
    const parsed = parseEventsJsonlFirstLine(eventsPath) ?? parseWorkspaceYaml(yamlPath);
    if (!parsed) continue;

    const createdAtMs = Date.parse(parsed.startTime);
    if (!Number.isFinite(createdAtMs)) continue;

    entries.push({
      sessionId: dirname,
      cwd: parsed.cwd,
      createdAtMs,
    });
  }

  return entries;
}

/**
 * Find the Copilot session UUID that matches a newly spawned session.
 *
 * Matching criteria:
 *   - cwd must match exactly
 *   - created_at must be within [startedAtMs - 5s, nowMs + 1s]
 *   - sessionId must not already be claimed by another mcode session
 *   - If multiple eligible entries, return null (ambiguous)
 */
export function selectCopilotSessionCandidate(
  entries: CopilotSessionEntry[],
  input: CopilotSessionMatchInput,
): string | null {
  const lowerBoundMs = input.startedAtMs - 5_000;
  const upperBoundMs = input.nowMs + 1_000;

  const eligible = entries.filter(entry =>
    entry.cwd === input.cwd
    && !input.claimedSessionIds.has(entry.sessionId)
    && entry.createdAtMs >= lowerBoundMs
    && entry.createdAtMs <= upperBoundMs,
  );

  return eligible.length === 1 ? eligible[0].sessionId : null;
}

/**
 * Combined: list sessions and match.
 * Returns the matched session UUID, or null if no unique match.
 */
export function findCopilotSessionId(input: CopilotSessionMatchInput): string | null {
  const entries = listCopilotSessions();
  return selectCopilotSessionCandidate(entries, input);
}

import { openSync, readSync, statSync, closeSync } from 'node:fs';
import { getTranscriptPath } from './session/transcript-path';
import type { SessionInfo } from '../shared/types';

/**
 * Permission-mode helpers used by the task dispatcher.
 *
 * Two responsibilities:
 *
 *  1. Determining a session's *current* permission mode. The authoritative
 *     source is the Claude Code JSONL transcript (the last human message
 *     carries a `permissionMode` field that reflects user-driven changes
 *     made via Shift+Tab cycling inside the TUI). If that's unavailable,
 *     we fall back to the mode the session was created with.
 *
 *  2. Computing the number of Shift+Tab presses needed to cycle from one
 *     mode to another, given a build-time `buildModeCycle()` permutation.
 *     `-1` is the sentinel for "either endpoint isn't in this cycle"
 *     (which should never happen at runtime — the queue validates at task
 *     creation — but the call site treats it as a soft warning).
 *
 *  Pure file I/O / pure arithmetic — no TaskQueue state coupling, hence
 *  the extraction.
 */

/**
 * Calculate the number of forward Shift+Tab presses to go from `current` to `target`
 * in the given cycle. Returns -1 if either mode is not in the cycle.
 */
export function calcShiftTabPresses(cycle: string[], current: string, target: string): number {
  const curIdx = cycle.indexOf(current);
  const tgtIdx = cycle.indexOf(target);
  if (curIdx === -1 || tgtIdx === -1) return -1;
  return (tgtIdx - curIdx + cycle.length) % cycle.length;
}

/**
 * Read the current permission mode for a session.
 * 1. Try the JSONL session log (last human message's permissionMode field)
 * 2. Fallback to the DB-stored permission_mode from session creation
 */
export function getCurrentPermissionMode(session: SessionInfo): string {
  if (session.claudeSessionId) {
    const mode = readLastPermissionModeFromJsonl(session.cwd, session.claudeSessionId);
    if (mode) return mode;
  }
  return session.permissionMode ?? 'default';
}

/**
 * Read the last permissionMode from a Claude Code JSONL session log.
 * Reads the tail of the file for efficiency.
 */
function readLastPermissionModeFromJsonl(cwd: string, claudeSessionId: string): string | null {
  try {
    const jsonlPath = getTranscriptPath(cwd, claudeSessionId);
    const stat = statSync(jsonlPath);
    const readSize = Math.min(stat.size, 16384); // Read last 16KB
    const buf = Buffer.alloc(readSize);
    const fd = openSync(jsonlPath, 'r');
    try {
      readSync(fd, buf, 0, readSize, stat.size - readSize);
    } finally {
      closeSync(fd);
    }
    const content = buf.toString('utf-8');
    const lines = content.split('\n');
    // Iterate from end to find last human message with permissionMode
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && obj.permissionMode) {
          return obj.permissionMode as string;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // File doesn't exist or can't be read — fall through to fallback
  }
  return null;
}

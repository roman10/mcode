import { open as fsOpen, stat, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getTranscriptPath } from './transcript-path';
import type { AgentSessionType } from '../../shared/session-agents';

/** Hard cap on bytes read from a transcript file. 1MB covers most real Claude
 *  sessions that hit the context limit (the JSONL is denser than the live tokens)
 *  while bounding memory. The compactor summarizes from whatever fits; full-transcript
 *  handoff truncates further at HANDOFF_SEED_MAX_CHARS. */
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;

interface ClaudeJsonlMessage {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

/** Pull the visible text out of a Claude message.content field. Content is either
 *  a string or an array of `{type, text|...}` blocks; we keep only text/thinking
 *  blocks and join with newlines. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as { type?: string; text?: string; thinking?: string };
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      else if (b.type === 'thinking' && typeof b.thinking === 'string') parts.push(b.thinking);
    }
  }
  return parts.join('\n');
}

/** Read a Claude JSONL transcript and flatten it into "Role: text" turns.
 *  Tool-use / tool-result blocks are dropped — they're noise for both
 *  compaction and full-transcript handoff. Returns an empty string if the
 *  file is missing. */
export async function readClaudeTranscript(cwd: string, claudeSessionId: string): Promise<string> {
  const path = getTranscriptPath(cwd, claudeSessionId);

  let fh: FileHandle;
  try {
    fh = await fsOpen(path, 'r');
  } catch {
    return '';
  }

  try {
    const stats = await stat(path);
    const readSize = Math.min(MAX_TRANSCRIPT_BYTES, stats.size);
    const offset = stats.size - readSize;
    const buf = Buffer.alloc(readSize);
    await fh.read(buf, 0, readSize, offset);
    const raw = buf.toString('utf-8');

    // If we truncated, drop the partial first line so JSON.parse doesn't choke.
    const isPartial = offset > 0;
    const firstNewline = raw.indexOf('\n');
    const chunk = isPartial && firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;

    const turns: string[] = [];
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      let obj: ClaudeJsonlMessage;
      try {
        obj = JSON.parse(line) as ClaudeJsonlMessage;
      } catch {
        continue;
      }
      const role = obj.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(obj.message?.content).trim();
      if (!text) continue;
      const label = role === 'user' ? 'User' : 'Assistant';
      turns.push(`${label}: ${text}`);
    }

    if (isPartial && turns.length > 0) {
      turns.unshift('[earlier turns omitted]');
    }
    return turns.join('\n\n');
  } finally {
    await fh.close();
  }
}

// ── Codex on-disk transcript ────────────────────────────────────────────────

interface CodexJsonlLine {
  type?: string;
  payload?: { type?: string; message?: unknown };
}

/** Locate the codex rollout JSONL for a thread id under `<codexHome>/sessions`.
 *  Codex names files `rollout-<timestamp>-<threadId>.jsonl` inside a
 *  YYYY/MM/DD directory tree. Returns the newest matching path, or null. */
async function findCodexRolloutFile(sessionsDir: string, threadId: string): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`;
  let yearDirs: string[];
  try {
    yearDirs = await readdir(sessionsDir);
  } catch {
    return null;
  }
  // Walk newest-first (descending) so the first hit is the latest rollout.
  for (const year of yearDirs.sort().reverse()) {
    const yearPath = join(sessionsDir, year);
    let monthDirs: string[];
    try {
      monthDirs = await readdir(yearPath);
    } catch {
      continue;
    }
    for (const month of monthDirs.sort().reverse()) {
      const monthPath = join(yearPath, month);
      let dayDirs: string[];
      try {
        dayDirs = await readdir(monthPath);
      } catch {
        continue;
      }
      for (const day of dayDirs.sort().reverse()) {
        const dayPath = join(monthPath, day);
        let files: string[];
        try {
          files = await readdir(dayPath);
        } catch {
          continue;
        }
        const match = files.find((f) => f.startsWith('rollout-') && f.endsWith(suffix));
        if (match) return join(dayPath, match);
      }
    }
  }
  return null;
}

/** Read a Codex rollout JSONL and flatten it into "Role: text" turns. Codex
 *  records human prompts as `event_msg`/`user_message` and assistant replies as
 *  `event_msg`/`agent_message`; everything else (reasoning, tool calls, token
 *  counts) is dropped as handoff noise. Returns '' if no rollout file is found.
 *
 *  Reads at most the trailing MAX_TRANSCRIPT_BYTES so a very long session stays
 *  bounded; the partial first line is discarded and the most recent turns kept. */
export async function readCodexTranscript(sessionsDir: string, threadId: string): Promise<string> {
  const path = await findCodexRolloutFile(sessionsDir, threadId);
  if (!path) return '';

  let fh: FileHandle;
  try {
    fh = await fsOpen(path, 'r');
  } catch {
    return '';
  }

  try {
    const stats = await stat(path);
    const readSize = Math.min(MAX_TRANSCRIPT_BYTES, stats.size);
    const offset = stats.size - readSize;
    const buf = Buffer.alloc(readSize);
    await fh.read(buf, 0, readSize, offset);
    const raw = buf.toString('utf-8');

    const isPartial = offset > 0;
    const firstNewline = raw.indexOf('\n');
    const chunk = isPartial && firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;

    const turns: string[] = [];
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      let obj: CodexJsonlLine;
      try {
        obj = JSON.parse(line) as CodexJsonlLine;
      } catch {
        continue;
      }
      if (obj.type !== 'event_msg') continue;
      const ptype = obj.payload?.type;
      if (ptype !== 'user_message' && ptype !== 'agent_message') continue;
      const text = typeof obj.payload?.message === 'string' ? obj.payload.message.trim() : '';
      if (!text) continue;
      const label = ptype === 'user_message' ? 'User' : 'Assistant';
      turns.push(`${label}: ${text}`);
    }

    if (isPartial && turns.length > 0) {
      turns.unshift('[earlier turns omitted]');
    }
    return turns.join('\n\n');
  } finally {
    await fh.close();
  }
}

/** Resolve a codex `sessions` dir from an account's session env. Falls back to
 *  the default `~/.codex/sessions` when CODEX_HOME isn't overridden. */
export function codexSessionsDirFromEnv(env: Record<string, string>): string {
  const codexHome = env.CODEX_HOME || join(homedir(), '.codex');
  return join(codexHome, 'sessions');
}

export interface ReadTranscriptInput {
  sessionType: AgentSessionType;
  cwd: string;
  claudeSessionId: string | null;
  /** Codex thread id — source of truth for codex on-disk transcript reads. */
  codexThreadId?: string | null;
  /** Codex `<home>/sessions` dir for the source account. Required to read codex on disk. */
  codexSessionsDir?: string;
  /** Live PTY scrollback fallback for sources where on-disk parsing isn't available. */
  ptyReplayBuffer?: string;
}

/** Read a session's transcript as plain text. Source of truth depends on the CLI:
 *  - Claude: JSONL transcript at ~/.claude/projects/.../<id>.jsonl
 *  - Other CLIs (v1): the PTY replay buffer for the live session (caller passes it in).
 *  Returns '' if no transcript is available. */
export async function readSessionTranscript(input: ReadTranscriptInput): Promise<string> {
  if (input.sessionType === 'claude' && input.claudeSessionId) {
    return readClaudeTranscript(input.cwd, input.claudeSessionId);
  }
  // Codex: prefer the on-disk rollout (works whether the session is running,
  // resumed, or ended). Falls through to PTY scrollback only when the thread id
  // or its rollout file isn't available.
  if (input.sessionType === 'codex' && input.codexThreadId && input.codexSessionsDir) {
    const transcript = await readCodexTranscript(input.codexSessionsDir, input.codexThreadId);
    if (transcript.trim()) return transcript;
  }
  return stripAnsi(input.ptyReplayBuffer ?? '');
}

/** Minimal ANSI/CSI/OSC escape stripper. Mirrors what the PTY scrollback contains:
 *  CSI sequences (ESC [ ... letter), OSC sequences (ESC ] ... ST/BEL), and bare ESC.
 *  Kept inline rather than depending on a lib so the main process surface stays small. */
function stripAnsi(input: string): string {
  if (!input) return '';
  // eslint-disable-next-line no-control-regex
  const csi = /\x1B\[[0-?]*[ -/]*[@-~]/g;
  // eslint-disable-next-line no-control-regex
  const osc = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
  // eslint-disable-next-line no-control-regex
  const otherEsc = /\x1B[@-Z\\-_]/g;
  return input.replace(csi, '').replace(osc, '').replace(otherEsc, '');
}

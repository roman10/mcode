import { open as fsOpen, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
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

export interface ReadTranscriptInput {
  sessionType: AgentSessionType;
  cwd: string;
  claudeSessionId: string | null;
  /** Live PTY scrollback for non-Claude sources where on-disk parsing isn't supported. */
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

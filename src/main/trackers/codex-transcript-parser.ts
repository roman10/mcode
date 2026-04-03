/**
 * Pure parser for Codex CLI JSONL transcript files.
 *
 * Extracts:
 *   - Token usage from `token_count` events → `info.last_token_usage` (per-API-call)
 *   - Human input from `user_message` events → `message` field
 *
 * Codex transcripts use newline-delimited JSON with distinct event types:
 *   - session_meta: session id, cwd, model_provider
 *   - turn_context: model, effort, cwd (one per turn)
 *   - event_msg with type "token_count": per-API-call token usage in `info.last_token_usage`
 *   - event_msg with type "user_message": human prompt text
 *
 * Model is tracked from turn_context events and applied to subsequent token_count events.
 * token_count events with `info: null` (rate-limited sessions) are skipped.
 */

import type { ParsedUsageEntry, ParsedHumanEntry } from './jsonl-usage-parser';

// ── JSONL line type interfaces ──────────────────────────────────────────────

interface CodexSessionMeta {
  type: 'session_meta';
  payload: { id?: string; cwd?: string };
}

interface CodexTurnContext {
  type: 'turn_context';
  payload: { model?: string };
}

interface CodexTokenCount {
  type: 'event_msg';
  timestamp: string;
  payload: {
    type: 'token_count';
    info: {
      last_token_usage: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens: number;
        total_tokens: number;
      };
    } | null;
  };
}

interface CodexUserMessage {
  type: 'event_msg';
  timestamp: string;
  payload: {
    type: 'user_message';
    message?: string;
  };
}

type CodexLine = CodexSessionMeta | CodexTurnContext | CodexTokenCount | CodexUserMessage;

// ── Exports ─────────────────────────────────────────────────────────────────

export interface CodexParseResult {
  sessionId: string | null;
  projectDir: string | null;
  tokenEntries: ParsedUsageEntry[];
  humanEntries: ParsedHumanEntry[];
}

/**
 * Parse a Codex JSONL transcript file into token usage and human input entries.
 */
export function parseCodexTranscript(content: string): CodexParseResult {
  const result: CodexParseResult = {
    sessionId: null,
    projectDir: null,
    tokenEntries: [],
    humanEntries: [],
  };

  let currentModel: string | null = null;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let line: CodexLine;
    try {
      line = JSON.parse(trimmed) as CodexLine;
    } catch {
      continue;
    }

    if (line.type === 'session_meta') {
      result.sessionId = line.payload?.id ?? null;
      const cwd = line.payload?.cwd;
      if (cwd) {
        result.projectDir = extractProjectDir(cwd);
      }
      continue;
    }

    if (line.type === 'turn_context') {
      const model = line.payload?.model;
      if (typeof model === 'string' && model) {
        currentModel = model;
      }
      continue;
    }

    if (line.type !== 'event_msg') continue;

    const payload = line.payload;
    if (!payload?.type) continue;

    if (payload.type === 'token_count') {
      const info = (payload as CodexTokenCount['payload']).info;
      if (!info?.last_token_usage) continue;
      if (!currentModel || !result.sessionId) continue;

      const usage = info.last_token_usage;
      const rawTimestamp = (line as CodexTokenCount).timestamp;
      const timestamp = typeof rawTimestamp === 'string' ? rawTimestamp : new Date().toISOString();
      if (!result.sessionId) continue;

      result.tokenEntries.push({
        messageId: `codex:${result.sessionId}:${timestamp}`,
        model: currentModel,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: usage.cached_input_tokens ?? 0,
        isFastMode: false,
        timestamp,
      });
    } else if (payload.type === 'user_message') {
      const message = (payload as CodexUserMessage['payload']).message;
      if (typeof message !== 'string' || !message) continue;

      const rawTimestamp = (line as CodexUserMessage).timestamp;
      const timestamp = typeof rawTimestamp === 'string' ? rawTimestamp : new Date().toISOString();
      if (!result.sessionId) continue;

      result.humanEntries.push({
        messageId: `codex:${result.sessionId}:${timestamp}`,
        timestamp,
        textLength: message.length,
        wordCount: message.split(/\s+/).filter(Boolean).length,
        text: message,
      });
    }
  }

  return result;
}

/** Derive a stable project identifier from an absolute CWD path. */
function extractProjectDir(cwd: string): string {
  // Use the last path segment as the project dir, matching other scanners.
  const segments = cwd.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || cwd;
}

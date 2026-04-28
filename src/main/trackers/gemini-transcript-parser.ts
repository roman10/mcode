/**
 * Pure parser for Gemini CLI transcript files.
 *
 * Supports two on-disk formats (Gemini CLI changed format around 2026-04-22):
 *   - Legacy `.json`: single JSON object `{ sessionId, messages: [...] }`.
 *   - Current `.jsonl`: line-delimited; line 1 is a header
 *     `{ sessionId, projectHash, ... }`, subsequent lines are either
 *     individual messages or `{"$set":{...}}` mongo-style update lines.
 *
 * Per-message shape is identical across both formats — the difference is
 * only in how messages are concatenated. `extractMessages` content-sniffs
 * and returns `GeminiMessage[]` regardless of format, so the rest of the
 * file works uniformly.
 *
 * Extracted data:
 *   - Token usage from `type: "gemini"` messages → inline `tokens` object
 *   - Human input from `type: "user"` messages → `content` array
 */

import type { ParsedUsageEntry, ParsedHumanEntry } from './jsonl-usage-parser';
import { normalizeGeminiModel } from './token-cost';

// ── Token usage from gemini messages ──────────────────────────────────────────

interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
}

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  content?: unknown;
  tokens?: GeminiTokens;
  model?: string;
}

interface GeminiTranscript {
  sessionId?: string;
  messages?: GeminiMessage[];
}

/**
 * Return the message array from a Gemini transcript regardless of format.
 *
 * Tries the legacy single-JSON shape first; only on parse failure does it fall
 * back to line-by-line JSONL parsing (skipping the header line and `$set`
 * update lines). A whole-file parse that succeeds but lacks a `messages` array
 * returns empty — it's a malformed legacy transcript, not a JSONL one.
 */
function extractMessages(content: string): GeminiMessage[] {
  try {
    const t = JSON.parse(content) as GeminiTranscript;
    return Array.isArray(t.messages) ? t.messages : [];
  } catch { /* not legacy JSON; try JSONL */ }

  const out: GeminiMessage[] = [];
  for (const raw of content.split('\n')) {
    if (!raw) continue;
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch { continue; }
    if (!obj || typeof obj !== 'object') continue;
    const m = obj as Record<string, unknown>;
    if ('$set' in m) continue;                       // mongo-style update line
    if (!('id' in m) || !('type' in m)) continue;    // header / unknown shape
    out.push(m as GeminiMessage);
  }
  return out;
}

/**
 * Parse token usage entries from a Gemini transcript file.
 * Creates one ParsedUsageEntry per `type: "gemini"` message with token data.
 *
 * Token mapping:
 *   inputTokens  = (tokens.input + tokens.tool) - tokens.cached  (uncached prompt only)
 *   outputTokens = tokens.output + tokens.thoughts  (generation + reasoning)
 *   cacheRead    = tokens.cached
 *
 * Gemini's `tokens.input` is the full promptTokenCount (cached + uncached). Storing
 * uncached only keeps `inputTokens` semantics consistent with the Anthropic convention.
 *
 * @param content - Full file content (legacy `.json` or new `.jsonl`)
 * @param sessionId - Gemini session UUID (from transcript or caller)
 */
export function parseGeminiTranscriptTokens(
  content: string,
  sessionId: string,
): ParsedUsageEntry[] {
  const messages = extractMessages(content);
  const entries: ParsedUsageEntry[] = [];

  for (const msg of messages) {
    if (msg.type !== 'gemini') continue;
    if (!msg.tokens || !msg.model) continue;

    const messageId = msg.id;
    if (!messageId) continue;

    const timestamp = msg.timestamp ?? new Date().toISOString();
    const tokens = msg.tokens;

    const cached = tokens.cached ?? 0;
    const rawInput = (tokens.input ?? 0) + (tokens.tool ?? 0);
    entries.push({
      messageId: `gemini:${sessionId}:${messageId}`,
      model: normalizeGeminiModel(msg.model),
      inputTokens: Math.max(0, rawInput - cached),
      outputTokens: (tokens.output ?? 0) + (tokens.thoughts ?? 0),
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: cached,
      isFastMode: false,
      timestamp,
    });
  }

  return entries;
}

// ── Human input from user messages ────────────────────────────────────────────

/**
 * Parse human input entries from Gemini transcript user messages.
 *
 * @param content - Full file content (legacy `.json` or new `.jsonl`)
 */
export function parseGeminiTranscriptHumanMessages(content: string): ParsedHumanEntry[] {
  const messages = extractMessages(content);
  const entries: ParsedHumanEntry[] = [];

  for (const msg of messages) {
    if (msg.type !== 'user') continue;

    const messageId = msg.id;
    if (!messageId) continue;

    const timestamp = msg.timestamp;
    if (!timestamp) continue;

    const text = extractUserText(msg.content);
    if (!text || text.length === 0) continue;

    entries.push({
      messageId: `gemini:${messageId}`,
      timestamp,
      textLength: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      text,
    });
  }

  return entries;
}

/** Extract text from Gemini user message content (string or array of {text} blocks). */
function extractUserText(content: unknown): string | null {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return null;

  let text = '';
  for (const block of content) {
    if (typeof block === 'object' && block !== null && typeof (block as Record<string, unknown>)['text'] === 'string') {
      text += (block as Record<string, unknown>)['text'];
    }
  }
  return text || null;
}

/**
 * Pure parser for Gemini CLI transcript JSON files.
 *
 * Extracts:
 *   - Token usage from `type: "gemini"` messages → `tokens` object (per-message)
 *   - Human input from `type: "user"` messages → `content` array
 *
 * Gemini transcript JSON uses a different format from Claude Code JSONL:
 *   - Single JSON object (not newline-delimited)
 *   - Token data is inline per gemini message, not in a `usage` sub-object
 *   - Fields: input, output, cached, thoughts, tool, total
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
 * Parse token usage entries from a Gemini transcript JSON file.
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
 * @param content - Full JSON file content
 * @param sessionId - Gemini session UUID (from transcript or caller)
 */
export function parseGeminiTranscriptTokens(
  content: string,
  sessionId: string,
): ParsedUsageEntry[] {
  let transcript: GeminiTranscript;
  try {
    transcript = JSON.parse(content) as GeminiTranscript;
  } catch {
    return [];
  }

  if (!Array.isArray(transcript.messages)) return [];

  const entries: ParsedUsageEntry[] = [];

  for (const msg of transcript.messages) {
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
 * @param content - Full JSON file content
 */
export function parseGeminiTranscriptHumanMessages(content: string): ParsedHumanEntry[] {
  let transcript: GeminiTranscript;
  try {
    transcript = JSON.parse(content) as GeminiTranscript;
  } catch {
    return [];
  }

  if (!Array.isArray(transcript.messages)) return [];

  const entries: ParsedHumanEntry[] = [];

  for (const msg of transcript.messages) {
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

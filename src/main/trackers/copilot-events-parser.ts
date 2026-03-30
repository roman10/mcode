/**
 * Parser for Copilot CLI events.jsonl files.
 *
 * Extracts:
 *   - Token usage from `session.shutdown` → `modelMetrics` (per-model aggregates)
 *   - Human input from `user.message` → `data.content` (raw user text)
 *
 * Copilot events.jsonl uses a different format from Claude Code JSONL:
 *   - Each line is a JSON event with `type`, `data`, `id`, `timestamp`
 *   - Token data comes from shutdown aggregates, not per-message usage fields
 *   - Human messages are separate `user.message` events
 */

import type { ParsedUsageEntry, ParsedHumanEntry } from './jsonl-usage-parser';

// ── Token usage from shutdown events ────────────────────────────────────────

interface ModelMetricEntry {
  requests: { count: number; cost: number };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

interface ShutdownData {
  totalPremiumRequests?: number;
  modelMetrics?: Record<string, ModelMetricEntry>;
  sessionStartTime?: number;
}

export interface CopilotTokenEntry extends ParsedUsageEntry {
  /** Per-model premium request count (Copilot subscription billing unit). */
  premiumRequests: number;
}

/**
 * Parse token usage entries from Copilot `session.shutdown` events.
 * Creates one CopilotTokenEntry per model found in `modelMetrics`.
 * Premium requests are tracked per-model (from `requests.cost`) to avoid
 * double-counting when multiple models are used in the same session.
 *
 * @param content - Full JSONL file content
 * @param sessionId - Copilot session UUID (directory name)
 */
export function parseCopilotShutdownTokens(
  content: string,
  sessionId: string,
): CopilotTokenEntry[] {
  const entries: CopilotTokenEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('"session.shutdown"')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj['type'] !== 'session.shutdown') continue;

    const data = obj['data'] as ShutdownData | undefined;
    if (!data?.modelMetrics) continue;

    const timestamp = (obj['timestamp'] as string) ?? new Date().toISOString();

    for (const [model, metrics] of Object.entries(data.modelMetrics)) {
      const usage = metrics.usage;
      if (!usage) continue;

      entries.push({
        messageId: `copilot:${sessionId}:${model}`,
        model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: usage.cacheWriteTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        isFastMode: false,
        timestamp,
        premiumRequests: metrics.requests?.cost ?? 0,
      });
    }
  }

  return entries;
}

// ── Human input from user.message events ────────────────────────────────────

/**
 * Parse human input entries from Copilot `user.message` events.
 * Uses `data.content` (raw user text, not `transformedContent` which includes system prompts).
 *
 * @param content - Full JSONL file content
 */
export function parseCopilotHumanMessages(content: string): ParsedHumanEntry[] {
  const entries: ParsedHumanEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('"user.message"')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj['type'] !== 'user.message') continue;

    const eventId = obj['id'] as string | undefined;
    if (!eventId) continue;

    const timestamp = obj['timestamp'] as string | undefined;
    if (!timestamp) continue;

    const data = obj['data'] as Record<string, unknown> | undefined;
    if (!data) continue;

    // Use raw `content`, not `transformedContent` (which includes system prompt injection)
    const text = data['content'] as string | undefined;
    if (!text || text.length === 0) continue;

    entries.push({
      messageId: `copilot:${eventId}`,
      timestamp,
      textLength: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    });
  }

  return entries;
}

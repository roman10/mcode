/**
 * Pure parser for extracting token usage data from Claude Code JSONL chunks.
 * Handles both top-level assistant messages and nested sub-agent progress messages.
 */

export interface ParsedUsageEntry {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  isFastMode: boolean;
  timestamp: string;
}

interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  speed?: string;
}

function extractFromUsage(usage: UsageFields): {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  isFastMode: boolean;
} {
  const cacheCreation = usage.cache_creation;
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;

  if (cacheCreation) {
    cacheWrite5m = cacheCreation.ephemeral_5m_input_tokens ?? 0;
    cacheWrite1h = cacheCreation.ephemeral_1h_input_tokens ?? 0;
  } else if (usage.cache_creation_input_tokens) {
    // No breakdown available — conservatively assign to 1h (Claude Code default)
    cacheWrite1h = usage.cache_creation_input_tokens;
  }

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheWrite5mTokens: cacheWrite5m,
    cacheWrite1hTokens: cacheWrite1h,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    isFastMode: usage.speed === 'fast',
  };
}

/**
 * Parse token usage entries from a JSONL chunk.
 * @param chunk - Raw JSONL text (newline-delimited JSON)
 * @param isPartialStart - If true, discard first line (may be incomplete from mid-file seek)
 */
export function parseUsageFromChunk(
  chunk: string,
  isPartialStart: boolean,
): ParsedUsageEntry[] {
  const entries: ParsedUsageEntry[] = [];
  const lines = chunk.split('\n');
  const startIdx = isPartialStart ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // Malformed line, skip
    }

    const type = obj['type'] as string | undefined;

    if (type === 'assistant') {
      const entry = parseAssistantMessage(obj);
      if (entry) entries.push(entry);
    } else if (type === 'progress') {
      const entry = parseProgressMessage(obj);
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

function parseAssistantMessage(obj: Record<string, unknown>): ParsedUsageEntry | null {
  const message = obj['message'] as Record<string, unknown> | undefined;
  if (!message) return null;

  const model = message['model'] as string | undefined;
  if (!model || model === '<synthetic>') return null;

  const usage = message['usage'] as UsageFields | undefined;
  if (!usage) return null;

  const uuid = obj['uuid'] as string | undefined;
  if (!uuid) return null;

  const timestamp = obj['timestamp'] as string | undefined;
  if (!timestamp) return null;

  const fields = extractFromUsage(usage);
  return {
    messageId: uuid,
    model,
    timestamp,
    ...fields,
  };
}

function parseProgressMessage(obj: Record<string, unknown>): ParsedUsageEntry | null {
  const data = obj['data'] as Record<string, unknown> | undefined;
  if (!data) return null;

  const outerMsg = data['message'] as Record<string, unknown> | undefined;
  if (!outerMsg) return null;

  const innerMsg = outerMsg['message'] as Record<string, unknown> | undefined;
  if (!innerMsg) return null;

  const model = innerMsg['model'] as string | undefined;
  if (!model || model === '<synthetic>') return null;

  const usage = innerMsg['usage'] as UsageFields | undefined;
  if (!usage) return null;

  // Use inner message id for dedup (multiple progress entries share same id)
  const messageId = innerMsg['id'] as string | undefined;
  if (!messageId) return null;

  const timestamp = obj['timestamp'] as string | undefined;
  if (!timestamp) return null;

  const fields = extractFromUsage(usage);
  return {
    messageId,
    model,
    timestamp,
    ...fields,
  };
}

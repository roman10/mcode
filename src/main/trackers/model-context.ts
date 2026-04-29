/**
 * Per-model context window sizes, used by the session-context badge in the
 * tile toolbar to compute "X / Y · Z%".
 *
 * Returns null for unknown models so the UI hides the size/percent rather
 * than displaying a misleading default — only the absolute used-tokens
 * portion is shown when the window is unknown.
 *
 * Pricing/capability concerns are kept separate: this file is window-size
 * only. Costs live in token-cost.ts.
 */

import type { AgentSessionType } from '@shared/session-agents';
import { normalizeModelVersion } from './token-cost';

const ONE_M = 1_000_000;
const TWO_HUNDRED_K = 200_000;

// Claude 4.x family: 200K standard. The 1M tier is opt-in via API beta and
// the model id carries a "[1m]" suffix in transcripts when active.
const CLAUDE_WINDOWS: Record<string, number> = {
  'opus-4.7':   TWO_HUNDRED_K,
  'opus-4.6':   TWO_HUNDRED_K,
  'opus-4.5':   TWO_HUNDRED_K,
  'opus-4.1':   TWO_HUNDRED_K,
  'opus-4':     TWO_HUNDRED_K,
  'sonnet-4.6': TWO_HUNDRED_K,
  'sonnet-4.5': TWO_HUNDRED_K,
  'sonnet-4':   TWO_HUNDRED_K,
  'sonnet-3.7': TWO_HUNDRED_K,
  'haiku-4.5':  TWO_HUNDRED_K,
  'haiku-3.5':  TWO_HUNDRED_K,
  'haiku-3':    TWO_HUNDRED_K,
};

/** Strict check on the raw model id — must match before normalization strips it. */
function hasOneMillionContextSuffix(rawModel: string): boolean {
  return /\[1m\]$/.test(rawModel);
}

/**
 * Look up the context window size (in tokens) for a model.
 *
 * @param rawModel  Model id as recorded in the transcript (pre-normalization).
 *                  E.g., "claude-opus-4-7-20251022" or "claude-opus-4-7[1m]".
 * @param provider  Source CLI. v1 only handles 'claude'; other providers
 *                  return null so the badge hides until they're wired up.
 */
export function getContextWindow(
  rawModel: string,
  provider: AgentSessionType,
): number | null {
  if (provider !== 'claude') return null;

  if (hasOneMillionContextSuffix(rawModel)) return ONE_M;

  const version = normalizeModelVersion(rawModel);
  return CLAUDE_WINDOWS[version] ?? null;
}

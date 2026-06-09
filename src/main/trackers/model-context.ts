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
 *
 * 1M-context detection has three layers, tried in order:
 *   1. The raw model id ends in "[1m]" — explicit and unambiguous.
 *   2. The default in CLAUDE_WINDOWS (e.g., opus-4.7 is natively 1M for
 *      Max/Team/Enterprise plans, which is the only tier where it ships).
 *   3. The user's `.claude/.claude.json` has historically recorded a
 *      "<model>[1m]" key under any project's `lastModelUsage` — i.e., the
 *      account has actually run that model in 1M mode at least once. This
 *      catches sonnet-4.6 / opus-4.6 / etc. on plans where 1M is enabled,
 *      since the JSONL transcript itself stores only the bare model id.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { AgentSessionType } from '@shared/session-agents';
import { logger } from '../logger';
import { normalizeModelVersion } from './token-cost';

const ONE_M = 1_000_000;
const TWO_HUNDRED_K = 200_000;

// Claude 4.x family. Defaults reflect each model's native window for the
// lowest plan that can use it. Fable 5 / Opus 4.7/4.8 are 1M because they ship
// only on plans where 1M is the default; the rest are 200K and bump to 1M only
// when the user has actually exercised the [1m] variant (see scanner below).
const CLAUDE_WINDOWS: Record<string, number> = {
  'fable-5':    ONE_M,
  'opus-4.8':   ONE_M,
  'opus-4.7':   ONE_M,
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

// ── Per-account `.claude.json` scan ──────────────────────────────────────────
//
// Claude Code's transcript stores the bare model id (e.g. "claude-opus-4-7")
// even when the session is using the 1M tier — the "[1m]" suffix only shows
// up in `~/.claude/.claude.json` under each project's `lastModelUsage`
// breakdown. We scan those files (across all account homes) to learn which
// models the user has actually run in 1M mode, then treat that as a hint
// that the user's plan supports 1M for that model.

const CACHE_TTL_MS = 60_000;

type PathsProvider = () => string[];

let pathsProvider: PathsProvider | null = null;
let cachedSet: Set<string> | null = null;
let cacheLoadedAt = 0;

/**
 * Register a function returning the absolute paths to every
 * `.claude/.claude.json` file we should scan (typically one per account home).
 * Called once during app startup; production wiring lives in token-tracker.
 */
export function setClaudeConfigPathsProvider(provider: PathsProvider): void {
  pathsProvider = provider;
  cachedSet = null;
  cacheLoadedAt = 0;
}

/** @internal — test-only cache reset */
export function _resetOneMillionContextCache(): void {
  pathsProvider = null;
  cachedSet = null;
  cacheLoadedAt = 0;
}

interface ClaudeJsonShape {
  projects?: Record<string, { lastModelUsage?: Record<string, unknown> }>;
}

function scanOneMillionModels(paths: string[]): Set<string> {
  const seen = new Set<string>();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let parsed: ClaudeJsonShape;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8')) as ClaudeJsonShape;
    } catch (err) {
      logger.debug('tokens', 'Failed to parse claude.json for 1M detection', {
        path,
        error: String(err),
      });
      continue;
    }
    const projects = parsed.projects ?? {};
    for (const project of Object.values(projects)) {
      const usage = project?.lastModelUsage;
      if (!usage) continue;
      for (const key of Object.keys(usage)) {
        // Match "claude-<anything>[1m]" — the suffix is what we care about.
        const m = /^claude-(.+)\[1m\]$/.exec(key);
        if (!m) continue;
        // Normalize the inner part the same way the lookup table is keyed.
        // normalizeModelVersion expects the "claude-" prefix, so re-prepend.
        const version = normalizeModelVersion(`claude-${m[1]}`);
        seen.add(version);
      }
    }
  }
  return seen;
}

function getOneMillionContextModels(): Set<string> {
  if (!pathsProvider) return new Set();
  const now = Date.now();
  if (cachedSet && now - cacheLoadedAt < CACHE_TTL_MS) return cachedSet;
  cachedSet = scanOneMillionModels(pathsProvider());
  cacheLoadedAt = now;
  return cachedSet;
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

  // If the user has run this model in 1M mode anywhere on this machine,
  // assume their plan still allows it for the bare-id session too.
  if (getOneMillionContextModels().has(version)) return ONE_M;

  return CLAUDE_WINDOWS[version] ?? null;
}

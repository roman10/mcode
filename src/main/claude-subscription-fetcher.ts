/**
 * Fetches subscription rate-limit utilization from the Anthropic OAuth usage endpoint.
 *
 * NOTE: This uses an internal Anthropic endpoint (anthropic-beta: oauth-2025-04-20).
 * It has no official support guarantee. All errors are silently swallowed and callers
 * receive null — the UI gracefully hides the section when data is unavailable.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { AccountProfile, SubscriptionUsage, SubscriptionUsageWindow } from '../shared/types';

const execFileAsync = promisify(execFile);

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const ANTHROPIC_BETA = 'oauth-2025-04-20';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  usage: SubscriptionUsage;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SubscriptionUsage | null>>();

function extractAccessToken(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // Format A: { accessToken: "..." }
    if (typeof obj['accessToken'] === 'string') return obj['accessToken'];
    // Format B: { claudeAiOauth: { accessToken: "..." } }
    const nested = obj['claudeAiOauth'];
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>)['accessToken'] === 'string') {
      return (nested as Record<string, unknown>)['accessToken'] as string;
    }
  } catch {
    // fall through
  }
  return null;
}

async function readAccessToken(account: AccountProfile): Promise<string | null> {
  const configDir = account.isDefault
    ? join(homedir(), '.claude')
    : join(account.homeDir!, '.claude');

  // 1. Try file-based credentials first (secondary accounts, or exported default)
  try {
    const raw = await readFile(join(configDir, '.credentials.json'), 'utf8');
    const token = extractAccessToken(raw);
    if (token) return token;
  } catch {
    // File not found or unreadable — fall through
  }

  // 2. Try Keychain on macOS.
  // Default account: service name is "Claude Code-credentials".
  // Secondary accounts: Claude Code appends the first 8 hex chars of sha256(CLAUDE_CONFIG_DIR)
  // to create an isolated service name, e.g. "Claude Code-credentials-22dfbf9b".
  if (process.platform === 'darwin') {
    const serviceName = account.isDefault
      ? 'Claude Code-credentials'
      : `Claude Code-credentials-${createHash('sha256').update(join(account.homeDir!, '.claude')).digest('hex').slice(0, 8)}`;
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password', '-s', serviceName, '-w',
      ]);
      const token = extractAccessToken(stdout.trim());
      if (token) return token;
    } catch {
      // Keychain access denied or entry not found
    }
  }

  return null;
}

export async function fetchSubscriptionUsage(
  account: AccountProfile,
  forceRefresh?: boolean,
): Promise<SubscriptionUsage | null> {
  const { accountId } = account;

  // Return cached result if still fresh (unless forced)
  if (!forceRefresh) {
    const cached = cache.get(accountId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.usage;
    }
  }

  // Deduplicate concurrent requests — return the in-flight promise if one exists
  const existing = inflight.get(accountId);
  if (existing) return existing;

  const promise = doFetch(account);
  inflight.set(accountId, promise);
  promise.finally(() => inflight.delete(accountId));
  return promise;
}

async function doFetch(account: AccountProfile): Promise<SubscriptionUsage | null> {
  const token = await readAccessToken(account);
  if (!token) return null;

  try {
    const res = await fetch(USAGE_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': ANTHROPIC_BETA,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return null;

    const usage: SubscriptionUsage = {
      windows: parseUsageResponse(await res.json()),
      fetchedAt: new Date().toISOString(),
    };

    // Atomically replace cache entry only on success
    cache.set(account.accountId, { usage, expiresAt: Date.now() + CACHE_TTL_MS });
    return usage;
  } catch {
    return null;
  }
}

// --- Response parsing (pure, exported for tests) ---

interface RawWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

interface RawLimit {
  kind?: string | null;
  percent?: number | null;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Maps the OAuth usage endpoint response into a flat list of rate-limit windows.
 *
 * Prefers the newer `limits[]` array, which is the general shape carrying per-model
 * scoped weekly limits (e.g. Fable, Opus, Sonnet) with human display names. Falls back
 * to the legacy flat keys (five_hour / seven_day / seven_day_opus) when `limits[]` is
 * absent or empty (older tokens).
 */
export function parseUsageResponse(raw: unknown): SubscriptionUsageWindow[] {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw as Record<string, unknown>;

  const limits = data['limits'];
  if (Array.isArray(limits) && limits.length > 0) {
    const windows = limits
      .map((entry) => toWindowFromLimit(entry as RawLimit))
      .filter((w): w is SubscriptionUsageWindow => w !== null);
    if (windows.length > 0) return windows;
  }

  // Legacy fallback: fixed flat keys.
  return [
    toWindowFromLegacy(data['five_hour'], 'five-hour', '5-hour'),
    toWindowFromLegacy(data['seven_day'], 'seven-day', '7-day'),
    toWindowFromLegacy(data['seven_day_opus'], 'seven-day-opus', 'Opus'),
  ].filter((w): w is SubscriptionUsageWindow => w !== null);
}

function toWindowFromLimit(limit: RawLimit): SubscriptionUsageWindow | null {
  if (!limit || typeof limit.percent !== 'number') return null;
  const kind = typeof limit.kind === 'string' ? limit.kind : null;
  const resetsAt = typeof limit.resets_at === 'string' ? limit.resets_at : null;

  if (kind === 'session') {
    return { id: 'five-hour', label: '5-hour', utilization: limit.percent, resetsAt, kind };
  }
  if (kind === 'weekly_all') {
    return { id: 'seven-day', label: '7-day', utilization: limit.percent, resetsAt, kind };
  }
  if (kind === 'weekly_scoped') {
    const name = limit.scope?.model?.display_name;
    const label = typeof name === 'string' && name.length > 0 ? name : 'Weekly (scoped)';
    const id = typeof name === 'string' && name.length > 0 ? `seven-day-${slug(name)}` : 'seven-day-scoped';
    return { id, label, utilization: limit.percent, resetsAt, kind };
  }
  return null; // unknown kind — skip rather than mislabel
}

function toWindowFromLegacy(raw: unknown, id: string, label: string): SubscriptionUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as RawWindow;
  if (typeof w.utilization !== 'number') return null;
  return {
    id,
    label,
    utilization: w.utilization,
    resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
    kind: null,
  };
}

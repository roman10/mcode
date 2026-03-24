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
import type { AccountProfile, SubscriptionUsage } from '../shared/types';

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

    const data = await res.json() as Record<string, { utilization: number; resets_at: string | null } | null>;

    const toWindow = (w: { utilization: number; resets_at: string | null } | null | undefined) =>
      w ? { utilization: w.utilization, resetsAt: w.resets_at } : null;

    const usage: SubscriptionUsage = {
      fiveHour: toWindow(data['five_hour']),
      sevenDay: toWindow(data['seven_day']),
      sevenDayOpus: toWindow(data['seven_day_opus']),
      fetchedAt: new Date().toISOString(),
    };

    // Atomically replace cache entry only on success
    cache.set(account.accountId, { usage, expiresAt: Date.now() + CACHE_TTL_MS });
    return usage;
  } catch {
    return null;
  }
}

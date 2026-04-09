/**
 * Fetches Gemini CLI quota utilization from the Google Code Assist internal API.
 *
 * Flow:
 *   1. Read refresh_token from ~/.gemini/oauth_creds.json (or per-account path)
 *   2. Exchange refresh_token for fresh access_token via Google OAuth
 *   3. Call loadCodeAssist to discover the cloudaicompanionProject (cached)
 *   4. Call retrieveUserQuota to get per-model remaining quota
 *
 * NOTE: This uses an internal Google endpoint (cloudcode-pa.googleapis.com/v1internal).
 * It has no official support guarantee — same pattern as Anthropic's internal OAuth endpoint
 * used by claude-subscription-fetcher. All errors are silently swallowed and callers
 * receive null — the UI gracefully hides the section when data is unavailable.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger';
import type { AccountProfile } from '../shared/types';

// ── Constants ────────────────────────────────────────────────────────────────

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Installed-app OAuth client credentials (same values as google-gemini/gemini-cli).
// Injected at build time by Vite define() — see electron.vite.config.ts and .env.local.template.
const OAUTH_CLIENT_ID     = __GEMINI_OAUTH_CLIENT_ID__;
const OAUTH_CLIENT_SECRET = __GEMINI_OAUTH_CLIENT_SECRET__;

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 10_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeminiBillingBucket {
  modelId: string;
  remainingFraction: number; // 0–1  (0.75 = 75% remaining)
  resetTime: string | null;  // ISO-8601
}

export interface GeminiBillingResult {
  buckets: GeminiBillingBucket[];
  fetchedAt: string;
}

interface CacheEntry {
  result: GeminiBillingResult;
  expiresAt: number;
}

// ── Cache / inflight ─────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<GeminiBillingResult | null>>();

// Project ID is stable per account — cache indefinitely within the process.
const projectCache = new Map<string, string>();

/** @internal — test-only cache reset */
export function _resetCaches(): void {
  cache.clear();
  inflight.clear();
  projectCache.clear();
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function fetchGeminiBilling(
  account: AccountProfile,
  forceRefresh?: boolean,
): Promise<GeminiBillingResult | null> {
  const { accountId } = account;

  if (!forceRefresh) {
    const cached = cache.get(accountId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }
  }

  const existing = inflight.get(accountId);
  if (existing) return existing;

  const promise = doFetch(account);
  inflight.set(accountId, promise);
  promise.finally(() => inflight.delete(accountId));
  return promise;
}

// ── Internals ────────────────────────────────────────────────────────────────

async function doFetch(account: AccountProfile): Promise<GeminiBillingResult | null> {
  try {
    const accessToken = await refreshAccessToken(account);
    if (!accessToken) return null;

    const projectId = await getProjectId(account, accessToken);
    if (!projectId) return null;

    const buckets = await retrieveUserQuota(accessToken, projectId);
    if (!buckets) return null;

    const result: GeminiBillingResult = {
      buckets,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(account.accountId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    logger.debug('gemini-billing', `Fetch failed for ${account.accountId}: ${err}`);
    return null;
  }
}

// ── OAuth token refresh ──────────────────────────────────────────────────────

function extractRefreshToken(raw: string): string | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj['refresh_token'] === 'string' ? obj['refresh_token'] : null;
  } catch {
    return null;
  }
}

async function readRefreshToken(account: AccountProfile): Promise<string | null> {
  const geminiHome = account.isDefault
    ? (process.env['GEMINI_CLI_HOME'] ?? homedir())
    : account.homeDir!;
  const credsPath = join(geminiHome, '.gemini', 'oauth_creds.json');

  // 1. Try file-based credentials first (works when GEMINI_FORCE_FILE_STORAGE=true)
  try {
    const raw = await readFile(credsPath, 'utf8');
    const token = extractRefreshToken(raw);
    if (token) return token;
  } catch {
    // File not found or unreadable — fall through to Keychain
  }

  // 2. Try macOS Keychain (default Gemini CLI stores creds as "gemini-cli-oauth" / "main-account")
  if (process.platform === 'darwin' && account.isDefault) {
    try {
      const { stdout } = await execFileAsync('security', [
        'find-generic-password', '-s', 'gemini-cli-oauth', '-a', 'main-account', '-w',
      ]);
      const token = extractRefreshToken(stdout.trim());
      if (token) return token;
    } catch {
      // Keychain access denied or entry not found
    }
  }

  return null;
}

async function refreshAccessToken(account: AccountProfile): Promise<string | null> {
  const refreshToken = await readRefreshToken(account);
  if (!refreshToken) return null;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    logger.debug('gemini-billing', `Token refresh failed: ${res.status}`);
    return null;
  }

  const data = await res.json() as { access_token?: string };
  return data.access_token ?? null;
}

// ── Code Assist API calls ────────────────────────────────────────────────────

async function codeAssistPost<T>(accessToken: string, method: string, body: object): Promise<T | null> {
  const res = await fetch(`${CODE_ASSIST_ENDPOINT}:${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    logger.debug('gemini-billing', `${method} failed: ${res.status}`);
    return null;
  }

  return await res.json() as T;
}

async function getProjectId(account: AccountProfile, accessToken: string): Promise<string | null> {
  const cached = projectCache.get(account.accountId);
  if (cached) return cached;

  interface LoadResponse {
    cloudaicompanionProject?: string;
  }

  const data = await codeAssistPost<LoadResponse>(accessToken, 'loadCodeAssist', {
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  });

  const projectId = data?.cloudaicompanionProject;
  if (!projectId) return null;

  projectCache.set(account.accountId, projectId);
  return projectId;
}

async function retrieveUserQuota(
  accessToken: string,
  projectId: string,
): Promise<GeminiBillingBucket[] | null> {
  interface BucketInfo {
    modelId?: string;
    remainingFraction?: number;
    resetTime?: string;
    tokenType?: string;
  }

  interface QuotaResponse {
    buckets?: BucketInfo[];
  }

  const data = await codeAssistPost<QuotaResponse>(accessToken, 'retrieveUserQuota', {
    project: projectId,
  });

  if (!data?.buckets) return null;

  return data.buckets
    .filter((b): b is BucketInfo & { modelId: string } =>
      typeof b.modelId === 'string' && typeof b.remainingFraction === 'number')
    .map((b) => ({
      modelId: b.modelId,
      remainingFraction: b.remainingFraction!,
      resetTime: b.resetTime ?? null,
    }));
}

/**
 * Fetches GitHub Copilot premium-request usage via the `gh` CLI.
 *
 * Endpoint: GET /users/{username}/settings/billing/premium_request/usage
 * Required scope: `user` (grant via `gh auth refresh -h github.com -s user`).
 *
 * Returns structured errors so the UI can show actionable setup hints.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const EXEC_TIMEOUT_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type CopilotBillingError =
  | 'gh-not-installed'
  | 'gh-not-authenticated'
  | 'scope-missing'
  | 'api-error';

export interface CopilotBillingUsage {
  username: string;
  usedRequests: number;
  limitRequests: number;
  utilization: number;  // 0–100+, can exceed 100 with overage
  resetsAt: string;     // ISO-8601, 1st of next month UTC
  fetchedAt: string;
}

export interface CopilotBillingResult {
  billing: CopilotBillingUsage | null;
  error: CopilotBillingError | null;
}

// ── Cache / inflight ──────────────────────────────────────────────────────────

interface CacheEntry {
  result: CopilotBillingResult;
  expiresAt: number;
}

let cached: CacheEntry | null = null;
let inflight: Promise<CopilotBillingResult> | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchCopilotBilling(
  forceRefresh?: boolean,
): Promise<CopilotBillingResult> {
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  if (inflight) return inflight;

  inflight = doFetch();
  try {
    const result = await inflight;
    // Only cache success — errors should retry quickly so users see the fix immediately
    if (result.billing) {
      cached = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return result;
  } finally {
    inflight = null;
  }
}

// ── Internals ─────────────────────────────────────────────────────────────────

async function ghExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('gh', args, { timeout: EXEC_TIMEOUT_MS });
}

async function doFetch(): Promise<CopilotBillingResult> {
  // Step 1: Get authenticated username
  let username: string;
  try {
    const { stdout } = await ghExec(['api', '/user', '--jq', '.login']);
    username = stdout.trim();
    if (!username) {
      return { billing: null, error: 'gh-not-authenticated' };
    }
  } catch (err: unknown) {
    return { billing: null, error: classifyGhError(err) };
  }

  // Step 2: Fetch billing usage
  let rawBody: string;
  try {
    const { stdout } = await ghExec([
      'api', `/users/${username}/settings/billing/premium_request/usage`,
      '--paginate',
    ]);
    rawBody = stdout;
  } catch (err: unknown) {
    const classified = classifyGhError(err);
    // 403/404 from this endpoint likely means missing `user` scope
    if (classified === 'api-error') {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      if (stderr.includes('scope') || stderr.includes('403') || stderr.includes('404')) {
        return { billing: null, error: 'scope-missing' };
      }
    }
    return { billing: null, error: classified };
  }

  // Step 3: Parse response
  const billing = parseBillingResponse(rawBody, username);
  if (!billing) {
    logger.debug('copilot-billing', 'Failed to parse billing response');
    return { billing: null, error: 'api-error' };
  }

  return { billing, error: null };
}

function classifyGhError(err: unknown): CopilotBillingError {
  const code = (err as { code?: string }).code;
  if (code === 'ENOENT') return 'gh-not-installed';

  const stderr = (err as { stderr?: string }).stderr ?? '';
  if (stderr.includes('auth login') || stderr.includes('not logged') || stderr.includes('authentication')) {
    return 'gh-not-authenticated';
  }
  if (stderr.includes('scope') || stderr.includes('403')) {
    return 'scope-missing';
  }
  logger.debug('copilot-billing', 'gh error: ' + (stderr || String(err)));
  return 'api-error';
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Parse the billing API response. The exact format may vary; this function is
 * kept isolated for easy adjustment once the real response shape is confirmed.
 *
 * Expected shape (GitHub REST API billing/usage):
 * {
 *   "usageItems": [
 *     { "date": "2026-04-01", "grossAmount": 5.0, "grossQuantity": 125, ... },
 *     ...
 *   ]
 * }
 * — OR an array of usage line items (when paginated).
 */
export function parseBillingResponse(
  raw: string,
  username: string,
): CopilotBillingUsage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  // The response may be an object with usageItems, or a direct array
  const items = extractUsageItems(data);
  if (!items) return null;

  // Sum premium requests for the current billing cycle
  let totalUsed = 0;
  let totalLimit = 0;

  for (const item of items) {
    const qty = typeof item.grossQuantity === 'number'
      ? item.grossQuantity
      : typeof item.quantity === 'number'
        ? item.quantity
        : 0;
    totalUsed += qty;

    // Try to extract limit from the item if available
    if (typeof item.limit === 'number' && item.limit > totalLimit) {
      totalLimit = item.limit;
    }
  }

  // If no explicit limit in response, infer from known plan defaults
  if (totalLimit === 0) {
    totalLimit = inferPlanLimit(items);
  }

  const utilization = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
  const resetsAt = computeNextMonthlyReset();

  return {
    username,
    usedRequests: totalUsed,
    limitRequests: totalLimit,
    utilization: Math.round(utilization * 10) / 10,
    resetsAt,
    fetchedAt: new Date().toISOString(),
  };
}

interface UsageItem {
  date?: string;
  grossQuantity?: number;
  quantity?: number;
  limit?: number;
  sku?: string;
  unitType?: string;
  [key: string]: unknown;
}

function extractUsageItems(data: unknown): UsageItem[] | null {
  if (Array.isArray(data)) return data as UsageItem[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['usageItems'])) return obj['usageItems'] as UsageItem[];
    if (Array.isArray(obj['usage_items'])) return obj['usage_items'] as UsageItem[];
    // Some endpoints return { days: [...] } or { items: [...] }
    if (Array.isArray(obj['days'])) return obj['days'] as UsageItem[];
    if (Array.isArray(obj['items'])) return obj['items'] as UsageItem[];
  }
  return null;
}

function inferPlanLimit(items: UsageItem[]): number {
  // Check if any item hints at the plan type
  for (const item of items) {
    const sku = String(item.sku ?? item['plan'] ?? '').toLowerCase();
    if (sku.includes('enterprise') || sku.includes('business')) return 1000;
    if (sku.includes('pro')) return 500;
  }
  // Default to Copilot Pro limit
  return 500;
}

function computeNextMonthlyReset(): string {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 11 ? 0 : now.getUTCMonth() + 1;
  return new Date(Date.UTC(year, month, 1)).toISOString();
}

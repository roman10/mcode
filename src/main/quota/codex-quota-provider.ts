import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { QuotaProviderAdapter } from './quota-provider';
import type { QuotaSnapshot, QuotaWindow } from '../../shared/types';
import { getAgentDefinition } from '../../shared/session-agents';
import { iterateCodexRolloutFiles } from '../trackers/codex-rollout-files';

const CACHE_TTL_MS = 60 * 1000;

interface CachedSnapshot {
  snapshot: QuotaSnapshot | null;
  expiresAt: number;
}

interface CodexRateLimitWindow {
  used_percent?: number;
  resets_at?: number;
  window_minutes?: number;
}

interface CodexRateLimitsPayload {
  limit_id?: string | null;
  limit_name?: string | null;
  plan_type?: string | null;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
}

interface CodexQuotaCandidate {
  timestamp: string;
  rateLimits: CodexRateLimitsPayload;
}

function resolveCodexSessionsDir(): string {
  const codexHome = process.env['MCODE_CODEX_HOME'] ?? join(homedir(), '.codex');
  return join(codexHome, 'sessions');
}

export class CodexQuotaProvider implements QuotaProviderAdapter {
  readonly provider = 'codex' as const;
  private cache: CachedSnapshot | null = null;
  private inflight: Promise<QuotaSnapshot | null> | null = null;

  async getSnapshots(forceRefresh?: boolean): Promise<QuotaSnapshot[]> {
    if (!forceRefresh && this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.snapshot ? [this.cache.snapshot] : [];
    }

    if (this.inflight) {
      const snapshot = await this.inflight;
      return snapshot ? [snapshot] : [];
    }

    this.inflight = this.loadSnapshot();
    try {
      const snapshot = await this.inflight;
      this.cache = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
      return snapshot ? [snapshot] : [];
    } finally {
      this.inflight = null;
    }
  }

  private async loadSnapshot(): Promise<QuotaSnapshot | null> {
    const files = await this.listRecentTranscriptFiles();
    for (const filePath of files) {
      const content = await readFile(filePath, 'utf8');
      const candidate = parseLatestCodexQuotaCandidate(content);
      if (!candidate) continue;

      const windows = buildCodexQuotaWindows(candidate.rateLimits);
      if (windows.length === 0) continue;

      return {
        provider: this.provider,
        sourceId: 'local-codex',
        sourceKind: 'local',
        displayName: getAgentDefinition(this.provider)?.displayName ?? 'Codex CLI',
        sourceLabel: 'Local Codex CLI',
        identity: null,
        planType: candidate.rateLimits.plan_type ?? null,
        fetchedAt: candidate.timestamp,
        windows,
      };
    }

    return null;
  }

  private async listRecentTranscriptFiles(): Promise<string[]> {
    const sessionsDir = resolveCodexSessionsDir();
    const fileStats: Array<{ path: string; mtimeMs: number }> = [];

    for await (const filePath of iterateCodexRolloutFiles(sessionsDir)) {
      try {
        const info = await stat(filePath);
        fileStats.push({ path: filePath, mtimeMs: info.mtimeMs });
      } catch {
        // Ignore transient file issues.
      }
    }

    return fileStats
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((entry) => entry.path);
  }
}

function parseLatestCodexQuotaCandidate(content: string): CodexQuotaCandidate | null {
  let latest: CodexQuotaCandidate | null = null;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;
    const line = parsed as {
      type?: string;
      timestamp?: string;
      payload?: {
        type?: string;
        rate_limits?: CodexRateLimitsPayload | null;
        info?: {
          rate_limits?: CodexRateLimitsPayload | null;
        } | null;
      };
    };

    if (line.type !== 'event_msg' || line.payload?.type !== 'token_count') continue;
    const rateLimits = line.payload.rate_limits ?? line.payload.info?.rate_limits;
    if (!rateLimits || typeof rateLimits !== 'object') continue;
    if (!line.timestamp) continue;

    latest = {
      timestamp: line.timestamp,
      rateLimits,
    };
  }

  return latest;
}

function buildCodexQuotaWindows(rateLimits: CodexRateLimitsPayload): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  const primary = toQuotaWindow('primary', 'Current', rateLimits.limit_id ?? null, rateLimits.primary);
  if (primary) windows.push(primary);
  const secondary = toQuotaWindow('secondary', 'Secondary', rateLimits.limit_id ?? null, rateLimits.secondary);
  if (secondary) windows.push(secondary);
  return windows;
}

function toQuotaWindow(
  id: string,
  fallbackLabel: string,
  limitId: string | null,
  window: CodexRateLimitWindow | null | undefined,
): QuotaWindow | null {
  if (typeof window?.used_percent !== 'number') return null;
  return {
    id,
    label: typeof window.window_minutes === 'number' ? formatWindowLabel(window.window_minutes) : fallbackLabel,
    utilization: window.used_percent,
    resetsAt: typeof window.resets_at === 'number' ? new Date(window.resets_at * 1000).toISOString() : null,
    limitId,
    windowMinutes: typeof window.window_minutes === 'number' ? window.window_minutes : null,
  };
}

function formatWindowLabel(windowMinutes: number): string {
  if (windowMinutes % (60 * 24 * 7) === 0) {
    return `${windowMinutes / (60 * 24 * 7)}w`;
  }
  if (windowMinutes % (60 * 24) === 0) {
    return `${windowMinutes / (60 * 24)}d`;
  }
  if (windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`;
  }
  return `${windowMinutes}m`;
}

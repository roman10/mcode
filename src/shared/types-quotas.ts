import type { AgentSessionType } from './session-agents';

// --- Subscription Usage ---

export interface RateLimitWindow {
  utilization: number;     // 0–100 percent
  resetsAt: string | null; // ISO-8601 datetime, or null
}

export interface SubscriptionUsage {
  fiveHour: RateLimitWindow | null;
  sevenDay: RateLimitWindow | null;
  sevenDayOpus: RateLimitWindow | null; // null if not present in API response
  fetchedAt: string; // ISO-8601 timestamp
}

export interface QuotaWindow {
  id: string;
  label: string;
  utilization: number;     // 0-100 percent
  resetsAt: string | null; // ISO-8601 datetime, or null
  limitId?: string | null;
  windowMinutes?: number | null;
}

export interface QuotaSnapshot {
  provider: AgentSessionType;
  sourceId: string;
  sourceKind: 'account' | 'local';
  displayName: string;
  sourceLabel: string | null;
  identity: string | null;
  planType: string | null;
  fetchedAt: string; // ISO-8601 timestamp
  windows: QuotaWindow[];
  setupHint?: string | null; // Shown when windows is empty, to guide user setup
}

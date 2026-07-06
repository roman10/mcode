import type { AgentSessionType } from './session-agents';

// --- Subscription Usage ---

export interface SubscriptionUsageWindow {
  id: string;              // stable kebab-case id, e.g. 'five-hour', 'seven-day', 'seven-day-fable'
  label: string;          // human label, e.g. '5-hour', '7-day', 'Fable'
  utilization: number;    // 0–100 percent
  resetsAt: string | null; // ISO-8601 datetime, or null
  kind: string | null;    // raw API 'kind' (session | weekly_all | weekly_scoped), or null for legacy keys
}

export interface SubscriptionUsage {
  // Generic list of rate-limit windows. Sourced from the API's `limits[]` array when
  // present (which surfaces per-model scoped weekly limits such as Fable/Opus/Sonnet),
  // falling back to the legacy flat keys (five_hour / seven_day / seven_day_opus).
  windows: SubscriptionUsageWindow[];
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

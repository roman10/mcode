import type { AgentSessionType } from '../../shared/session-agents';
import type { QuotaSnapshot } from '../../shared/types';

export interface QuotaProviderAdapter {
  readonly provider: AgentSessionType;
  getSnapshots(forceRefresh?: boolean): Promise<QuotaSnapshot[]>;
}

export class QuotaProviderRegistry {
  private adapters = new Map<AgentSessionType, QuotaProviderAdapter>();

  register(adapter: QuotaProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: AgentSessionType): QuotaProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  getRegistered(): QuotaProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

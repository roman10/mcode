import type { AgentSessionType } from '../../shared/session-agents';
import type { QuotaSnapshot } from '../../shared/types';
import type { QuotaProviderRegistry } from './quota-provider';

export class QuotaService {
  constructor(private registry: QuotaProviderRegistry) {}

  async list(forceRefresh?: boolean, provider?: AgentSessionType): Promise<QuotaSnapshot[]> {
    const adapters = provider
      ? [this.registry.get(provider)].filter((value): value is NonNullable<typeof value> => !!value)
      : this.registry.getRegistered();

    const snapshots = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          return await adapter.getSnapshots(forceRefresh);
        } catch {
          return [];
        }
      }),
    );

    return snapshots.flat().sort(compareSnapshots);
  }
}

function compareSnapshots(a: QuotaSnapshot, b: QuotaSnapshot): number {
  const providerOrder = providerRank(a.provider) - providerRank(b.provider);
  if (providerOrder !== 0) return providerOrder;
  return a.sourceId.localeCompare(b.sourceId);
}

function providerRank(provider: AgentSessionType): number {
  switch (provider) {
    case 'claude':
      return 0;
    case 'codex':
      return 1;
    case 'gemini':
      return 2;
    case 'copilot':
      return 3;
    default:
      return 99;
  }
}

import type { QuotaProviderAdapter } from './quota-provider';
import type { QuotaSnapshot } from '../../shared/types';
import { getAgentDefinition } from '../../shared/session-agents';
import { fetchCopilotBilling } from '../copilot-billing-fetcher';
import type { CopilotBillingError } from '../copilot-billing-fetcher';

export class CopilotQuotaProvider implements QuotaProviderAdapter {
  readonly provider = 'copilot' as const;

  async getSnapshots(forceRefresh?: boolean): Promise<QuotaSnapshot[]> {
    const result = await fetchCopilotBilling(forceRefresh);

    if (result.billing) {
      const { billing } = result;
      return [{
        provider: this.provider,
        sourceId: `gh-${billing.username}`,
        sourceKind: 'account',
        displayName: getAgentDefinition(this.provider)?.displayName ?? 'Copilot CLI',
        sourceLabel: billing.username,
        identity: billing.username,
        planType: null,
        fetchedAt: billing.fetchedAt,
        windows: [{
          id: 'monthly',
          label: 'Monthly',
          utilization: billing.utilization,
          resetsAt: billing.resetsAt,
        }],
      }];
    }

    if (result.error) {
      return [{
        provider: this.provider,
        sourceId: 'copilot-setup',
        sourceKind: 'account',
        displayName: getAgentDefinition(this.provider)?.displayName ?? 'Copilot CLI',
        sourceLabel: null,
        identity: null,
        planType: null,
        fetchedAt: new Date().toISOString(),
        windows: [],
        setupHint: getSetupHint(result.error),
      }];
    }

    return [];
  }
}

function getSetupHint(error: CopilotBillingError): string {
  switch (error) {
    case 'gh-not-installed':
      return 'Install GitHub CLI: brew install gh';
    case 'gh-not-authenticated':
      return 'Run: gh auth login';
    case 'scope-missing':
      return 'Run: gh auth refresh -h github.com -s user';
    default:
      return 'GitHub API unavailable';
  }
}

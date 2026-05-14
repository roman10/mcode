import { typedHandle } from '../ipc-helpers';
import type { QuotaService } from '../quota/quota-service';

export function registerQuotaIpc(quotaService: QuotaService): void {
  typedHandle('quota:list', (forceRefresh) => {
    return quotaService.list(forceRefresh);
  });
}

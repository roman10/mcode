import type { TokenTracker } from '../trackers/token-tracker';
import { typedHandle } from '../ipc-helpers';

export function registerTokenIpc(tokenTracker: TokenTracker): void {
  typedHandle('tokens:get-session-usage', (sessionId) => {
    return tokenTracker.getSessionUsage(sessionId);
  });

  typedHandle('tokens:get-daily-usage', (date, provider) => {
    return tokenTracker.getDailyUsage(date, provider);
  });

  typedHandle('tokens:get-model-breakdown', (days, provider) => {
    return tokenTracker.getModelBreakdown(days, provider);
  });

  typedHandle('tokens:get-heatmap', (startDate, endDate, provider, fillEmptyDays) => {
    return tokenTracker.getHeatmap(startDate, endDate, provider, fillEmptyDays);
  });

  typedHandle('tokens:refresh', async () => {
    await tokenTracker.scanAll();
  });
}

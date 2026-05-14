import type { InputTracker } from '../trackers/input-tracker';
import { typedHandle } from '../ipc-helpers';

export function registerInputIpc(inputTracker: InputTracker): void {
  typedHandle('input:get-daily-stats', (date, provider) => {
    return inputTracker.getDailyInputStats(date, provider);
  });

  typedHandle('input:get-heatmap', (startDate, endDate, provider, fillEmptyDays) => {
    return inputTracker.getInputHeatmap(startDate, endDate, provider, fillEmptyDays);
  });

  typedHandle('input:get-cadence', (date, provider) => {
    return inputTracker.getInputCadence(date, provider);
  });

  typedHandle('prompt-history:search', (query, limit) => {
    return inputTracker.searchPrompts(query, limit);
  });

  typedHandle('prompt-history:recent', (limit) => {
    return inputTracker.recentPrompts(limit);
  });

  typedHandle('prompt-history:delete', (id) => {
    inputTracker.deletePrompt(id);
  });

  typedHandle('prompt-history:toggle-pin', (id) => {
    inputTracker.togglePin(id);
  });
}

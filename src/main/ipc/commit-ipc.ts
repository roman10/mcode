import type { CommitTracker } from '../trackers/commit-tracker';
import { typedHandle } from '../ipc-helpers';

export function registerCommitIpc(commitTracker: CommitTracker): void {
  typedHandle('commits:get-daily-stats', (date, provider) => {
    return commitTracker.getDailyStats(date, provider);
  });

  typedHandle('commits:get-heatmap', (startDate, endDate, provider, fillEmptyDays) => {
    return commitTracker.getHeatmap(startDate, endDate, provider, fillEmptyDays);
  });

  typedHandle('commits:get-streaks', (provider) => {
    return commitTracker.getStreaks(provider);
  });

  typedHandle('commits:get-cadence', (date, provider) => {
    return commitTracker.getCadence(date, provider);
  });

  typedHandle('commits:refresh', async () => {
    await commitTracker.scanAll();
  });

  typedHandle('commits:force-rescan', async () => {
    await commitTracker.forceRescan();
  });
}

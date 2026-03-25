import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

interface DailyStats {
  date: string;
  total: number;
  totalInsertions: number;
  totalDeletions: number;
  claudeAssisted: number;
  soloCount: number;
  byRepo: Array<{ repoPath: string; count: number; insertions: number; deletions: number }>;
  byType: Array<{ type: string; count: number }>;
}

interface HeatmapEntry {
  date: string;
  count: number;
  insertions: number;
}

interface Streaks {
  current: number;
  longest: number;
}

interface Cadence {
  avgMinutes: number | null;
  peakHour: string | null;
  commitsByHour: Record<string, number>;
}

interface WeeklyTrend {
  thisWeek: number;
  lastWeek: number;
  percentChange: number | null;
}

describe('commit tracking', () => {
  const client = new McpTestClient();
  let originalScanMode: boolean;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);

    // Trigger a scan to ensure tracker has data
    await client.callToolText('commits_refresh');

    // Save original scan mode
    const mode = await client.callToolJson<{ scanAllBranches: boolean }>(
      'commits_get_scan_mode',
    );
    originalScanMode = mode.scanAllBranches;
  });

  afterAll(async () => {
    // Restore original scan mode
    await client.callTool('commits_set_scan_mode', {
      scanAllBranches: originalScanMode,
    });
    await client.disconnect();
  });

  it('commits_refresh completes', async () => {
    const text = await client.callToolText('commits_refresh');
    expect(text).toContain('Scan complete');
  });

  it('commits_force_rescan completes and returns stats', async () => {
    const text = await client.callToolText('commits_force_rescan');
    expect(text).toContain('Force rescan complete');
  });

  it('get_daily_stats returns valid shape', async () => {
    const stats = await client.callToolJson<DailyStats>(
      'commits_get_daily_stats',
    );
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(stats.claudeAssisted).toBeGreaterThanOrEqual(0);
    expect(stats.soloCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(stats.byRepo)).toBe(true);
    expect(Array.isArray(stats.byType)).toBe(true);
  });

  it('get_daily_stats accepts date parameter', async () => {
    const stats = await client.callToolJson<DailyStats>(
      'commits_get_daily_stats',
      { date: '2020-01-01' },
    );
    expect(stats.total).toBe(0);
  });

  it('get_heatmap returns array of entries', async () => {
    const heatmap = await client.callToolJson<HeatmapEntry[]>(
      'commits_get_heatmap',
    );
    expect(Array.isArray(heatmap)).toBe(true);
    expect(heatmap.length).toBe(7);
    for (const entry of heatmap) {
      expect(typeof entry.date).toBe('string');
      expect(typeof entry.count).toBe('number');
    }
  });

  it('get_heatmap respects days parameter', async () => {
    const heatmap = await client.callToolJson<HeatmapEntry[]>(
      'commits_get_heatmap',
      { days: 3 },
    );
    expect(heatmap.length).toBe(3);
  });

  it('get_streaks returns streak info', async () => {
    const streaks = await client.callToolJson<Streaks>(
      'commits_get_streaks',
    );
    expect(streaks.current).toBeGreaterThanOrEqual(0);
    expect(streaks.longest).toBeGreaterThanOrEqual(0);
  });

  it('get_cadence returns cadence info', async () => {
    const cadence = await client.callToolJson<Cadence>(
      'commits_get_cadence',
    );
    expect('avgMinutes' in cadence).toBe(true);
    expect('peakHour' in cadence).toBe(true);
    expect(typeof cadence.commitsByHour).toBe('object');
  });

  it('get_weekly_trend returns trend info', async () => {
    const trend = await client.callToolJson<WeeklyTrend>(
      'commits_get_weekly_trend',
    );
    expect(typeof trend.thisWeek).toBe('number');
    expect(typeof trend.lastWeek).toBe('number');
  });

  it('get_scan_mode returns current mode', async () => {
    const mode = await client.callToolJson<{ scanAllBranches: boolean }>(
      'commits_get_scan_mode',
    );
    expect(typeof mode.scanAllBranches).toBe('boolean');
  });

  it('set_scan_mode round-trips correctly', async () => {
    // Read current
    const before = await client.callToolJson<{ scanAllBranches: boolean }>(
      'commits_get_scan_mode',
    );

    // Set opposite
    const opposite = !before.scanAllBranches;
    await client.callTool('commits_set_scan_mode', {
      scanAllBranches: opposite,
    });

    // Verify change
    const after = await client.callToolJson<{ scanAllBranches: boolean }>(
      'commits_get_scan_mode',
    );
    expect(after.scanAllBranches).toBe(opposite);

    // Restore (afterAll also restores, but be clean within the test)
    await client.callTool('commits_set_scan_mode', {
      scanAllBranches: before.scanAllBranches,
    });
  });
});

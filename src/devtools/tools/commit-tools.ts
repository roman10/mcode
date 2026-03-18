import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPreferenceBool, setPreferenceBool } from '../../main/preferences';
import type { McpServerContext } from '../types';

export function registerCommitTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('commits_get_daily_stats', {
    description: 'Get commit statistics for a given day (default: today). Includes total count, lines changed, Claude vs solo breakdown, per-repo stats, and commit type distribution.',
    inputSchema: {
      date: z.string().optional().describe('ISO date string (e.g., "2026-03-18"). Defaults to today.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const stats = ctx.commitTracker.getDailyStats(date);
    return {
      content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
    };
  });

  server.registerTool('commits_get_heatmap', {
    description: 'Get commit count heatmap for the last N days (default: 7). Returns per-day counts and insertion totals.',
    inputSchema: {
      days: z.number().int().positive().optional().describe('Number of days to include (default: 7)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days }) => {
    const heatmap = ctx.commitTracker.getHeatmap(days);
    return {
      content: [{ type: 'text', text: JSON.stringify(heatmap, null, 2) }],
    };
  });

  server.registerTool('commits_get_streaks', {
    description: 'Get current and longest commit streaks (consecutive days with at least one commit).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const streaks = ctx.commitTracker.getStreaks();
    return {
      content: [{ type: 'text', text: JSON.stringify(streaks, null, 2) }],
    };
  });

  server.registerTool('commits_get_cadence', {
    description: 'Get commit cadence for a given day: average minutes between commits, peak hour, and per-hour distribution.',
    inputSchema: {
      date: z.string().optional().describe('ISO date string. Defaults to today.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const cadence = ctx.commitTracker.getCadence(date);
    return {
      content: [{ type: 'text', text: JSON.stringify(cadence, null, 2) }],
    };
  });

  server.registerTool('commits_get_weekly_trend', {
    description: 'Get this week vs last week commit comparison with percentage change.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const trend = ctx.commitTracker.getWeeklyTrend();
    return {
      content: [{ type: 'text', text: JSON.stringify(trend, null, 2) }],
    };
  });

  server.registerTool('commits_refresh', {
    description: 'Trigger an immediate scan of all tracked repositories for new commits.',
    annotations: { readOnlyHint: false },
  }, async () => {
    await ctx.commitTracker.scanAll();
    const stats = ctx.commitTracker.getDailyStats();
    return {
      content: [{ type: 'text', text: `Scan complete. Today: ${stats.total} commits.\n\n${JSON.stringify(stats, null, 2)}` }],
    };
  });

  server.registerTool('commits_get_scan_mode', {
    description: 'Get the current branch scan mode. Returns whether all branches are scanned (true) or only the default/main branch (false).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const scanAllBranches = getPreferenceBool('commitScanAllBranches', false);
    return {
      content: [{ type: 'text', text: JSON.stringify({ scanAllBranches }, null, 2) }],
    };
  });

  server.registerTool('commits_set_scan_mode', {
    description: 'Set the branch scan mode. When scanAllBranches is true, all branches are scanned. When false (default), only the main/master branch is scanned. Triggers an immediate rescan.',
    inputSchema: {
      scanAllBranches: z.boolean().describe('Whether to scan all branches (true) or only the default branch (false)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ scanAllBranches }) => {
    setPreferenceBool('commitScanAllBranches', scanAllBranches);
    await ctx.commitTracker.scanAll();
    const stats = ctx.commitTracker.getDailyStats();
    return {
      content: [{ type: 'text', text: JSON.stringify({ scanAllBranches, todayTotal: stats.total }, null, 2) }],
    };
  });
}

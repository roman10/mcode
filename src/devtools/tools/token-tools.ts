import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

export function registerTokenTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('tokens_get_session_usage', {
    description: 'Get token usage and estimated cost for a specific Claude session ID. Returns per-model breakdown with input/output/cache tokens and USD cost estimate.',
    inputSchema: {
      claudeSessionId: z.string().describe('The Claude session ID (UUID from the JSONL filename)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ claudeSessionId }) => {
    const usage = ctx.tokenTracker.getSessionUsage(claudeSessionId);
    return {
      content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }],
    };
  });

  server.registerTool('tokens_get_daily_usage', {
    description: 'Get aggregated token usage and estimated cost for a given day (default: today). Includes per-model breakdown and top sessions by cost.',
    inputSchema: {
      date: z.string().optional().describe('ISO date string (e.g., "2026-03-19"). Defaults to today.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const usage = ctx.tokenTracker.getDailyUsage(date);
    return {
      content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }],
    };
  });

  server.registerTool('tokens_get_model_breakdown', {
    description: 'Get token usage broken down by model over the last N days (default: 30). Shows each model\'s share of total estimated cost.',
    inputSchema: {
      days: z.number().int().positive().optional().describe('Number of days to include (default: 30)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days }) => {
    const breakdown = ctx.tokenTracker.getModelBreakdown(days);
    return {
      content: [{ type: 'text', text: JSON.stringify(breakdown, null, 2) }],
    };
  });

  server.registerTool('tokens_get_weekly_trend', {
    description: 'Get this week vs last week token usage comparison with percentage change and estimated cost.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const trend = ctx.tokenTracker.getWeeklyTrend();
    return {
      content: [{ type: 'text', text: JSON.stringify(trend, null, 2) }],
    };
  });

  server.registerTool('tokens_get_heatmap', {
    description: 'Get daily token usage heatmap for the last N days (default: 7). Returns per-day output tokens, message count, and estimated cost.',
    inputSchema: {
      days: z.number().int().positive().optional().describe('Number of days to include (default: 7)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days }) => {
    const heatmap = ctx.tokenTracker.getHeatmap(days);
    return {
      content: [{ type: 'text', text: JSON.stringify(heatmap, null, 2) }],
    };
  });

  server.registerTool('tokens_refresh', {
    description: 'Trigger an immediate scan of all Claude Code JSONL files for new token usage data. Returns a summary of today\'s usage after scanning.',
    annotations: { readOnlyHint: false },
  }, async () => {
    await ctx.tokenTracker.scanAll();
    const daily = ctx.tokenTracker.getDailyUsage();
    return {
      content: [{
        type: 'text',
        text: `Scan complete. Today: ${daily.messageCount} messages, estimated $${daily.estimatedCostUsd.toFixed(4)} USD.\n\n${JSON.stringify(daily, null, 2)}`,
      }],
    };
  });
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
}

interface DailyTokenUsage {
  date: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  byModel: Array<{ model: string; modelFamily: string }>;
  topSessions: Array<{ claudeSessionId: string; estimatedCostUsd: number }>;
}

interface SessionTokenUsage {
  claudeSessionId: string;
  models: Array<{ model: string }>;
  totals: TokenTotals;
  estimatedCostUsd: number;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

interface ModelBreakdownEntry {
  model: string;
  modelFamily: string;
  totals: TokenTotals;
  estimatedCostUsd: number;
  pctOfTotalCost: number;
}

interface TokenWeeklyTrend {
  thisWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  lastWeek: { outputTokens: number; estimatedCostUsd: number; messageCount: number };
  pctChange: number | null;
}

interface TokenHeatmapEntry {
  date: string;
  outputTokens: number;
  estimatedCostUsd: number;
  messageCount: number;
}

describe('token usage', () => {
  const client = new McpTestClient();

  beforeAll(async () => {
    await client.connect();
    // Trigger scan to ensure data is populated
    await client.callToolText('tokens_refresh');
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('tokens_refresh completes and returns summary', async () => {
    const text = await client.callToolText('tokens_refresh');
    expect(text).toContain('Scan complete');
  });

  it('get_daily_usage returns valid shape', async () => {
    const usage = await client.callToolJson<DailyTokenUsage>('tokens_get_daily_usage', {});
    expect(typeof usage.date).toBe('string');
    expect(typeof usage.totals.inputTokens).toBe('number');
    expect(typeof usage.totals.outputTokens).toBe('number');
    expect(typeof usage.estimatedCostUsd).toBe('number');
    expect(usage.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    expect(typeof usage.messageCount).toBe('number');
    expect(usage.messageCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(usage.byModel)).toBe(true);
    expect(Array.isArray(usage.topSessions)).toBe(true);
  });

  it('get_daily_usage accepts date parameter', async () => {
    const usage = await client.callToolJson<DailyTokenUsage>('tokens_get_daily_usage', {
      date: '2020-01-01',
    });
    expect(usage.messageCount).toBe(0);
    expect(usage.estimatedCostUsd).toBe(0);
  });

  it('get_session_usage returns valid shape', async () => {
    const usage = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { claudeSessionId: 'nonexistent-test-uuid' },
    );
    expect(typeof usage.claudeSessionId).toBe('string');
    expect(Array.isArray(usage.models)).toBe(true);
    expect(typeof usage.totals).toBe('object');
    expect(typeof usage.estimatedCostUsd).toBe('number');
    expect(typeof usage.messageCount).toBe('number');
  });

  it('get_session_usage returns zeros for unknown session', async () => {
    const usage = await client.callToolJson<SessionTokenUsage>(
      'tokens_get_session_usage',
      { claudeSessionId: 'nonexistent-test-uuid' },
    );
    expect(usage.messageCount).toBe(0);
  });

  it('get_model_breakdown returns array', async () => {
    const breakdown = await client.callToolJson<ModelBreakdownEntry[]>(
      'tokens_get_model_breakdown',
      {},
    );
    expect(Array.isArray(breakdown)).toBe(true);
    for (const entry of breakdown) {
      expect(typeof entry.model).toBe('string');
      expect(typeof entry.modelFamily).toBe('string');
      expect(typeof entry.totals).toBe('object');
      expect(typeof entry.estimatedCostUsd).toBe('number');
      expect(typeof entry.pctOfTotalCost).toBe('number');
    }
  });

  it('get_model_breakdown respects days parameter', async () => {
    const short = await client.callToolJson<ModelBreakdownEntry[]>(
      'tokens_get_model_breakdown',
      { days: 1 },
    );
    const long = await client.callToolJson<ModelBreakdownEntry[]>(
      'tokens_get_model_breakdown',
      { days: 30 },
    );
    expect(Array.isArray(short)).toBe(true);
    expect(Array.isArray(long)).toBe(true);
  });

  it('get_weekly_trend returns trend shape', async () => {
    const trend = await client.callToolJson<TokenWeeklyTrend>('tokens_get_weekly_trend');
    expect(typeof trend.thisWeek.outputTokens).toBe('number');
    expect(typeof trend.thisWeek.estimatedCostUsd).toBe('number');
    expect(typeof trend.thisWeek.messageCount).toBe('number');
    expect(typeof trend.lastWeek.outputTokens).toBe('number');
    expect(typeof trend.lastWeek.estimatedCostUsd).toBe('number');
    expect(typeof trend.lastWeek.messageCount).toBe('number');
  });

  it('get_heatmap returns array with correct length', async () => {
    const heatmap = await client.callToolJson<TokenHeatmapEntry[]>(
      'tokens_get_heatmap',
      {},
    );
    expect(heatmap).toHaveLength(7);
    for (const entry of heatmap) {
      expect(typeof entry.date).toBe('string');
      expect(typeof entry.outputTokens).toBe('number');
      expect(typeof entry.estimatedCostUsd).toBe('number');
      expect(typeof entry.messageCount).toBe('number');
    }

    // Test with custom days
    const short = await client.callToolJson<TokenHeatmapEntry[]>(
      'tokens_get_heatmap',
      { days: 3 },
    );
    expect(short).toHaveLength(3);
  });
});

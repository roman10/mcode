import { describe, it, expect } from 'vitest';
import { parseCopilotShutdownTokens, parseCopilotHumanMessages } from '../../../src/main/trackers/copilot-events-parser';

describe('parseCopilotShutdownTokens', () => {
  it('extracts token usage from session.shutdown modelMetrics', () => {
    const content = JSON.stringify({
      type: 'session.shutdown',
      data: {
        totalPremiumRequests: 5,
        modelMetrics: {
          'gpt-5.4': {
            requests: { count: 33, cost: 5 },
            usage: { inputTokens: 3303725, outputTokens: 15480, cacheReadTokens: 2867968, cacheWriteTokens: 0 },
          },
          'claude-sonnet-4.5': {
            requests: { count: 28, cost: 0 },
            usage: { inputTokens: 1327340, outputTokens: 8483, cacheReadTokens: 1157243, cacheWriteTokens: 0 },
          },
        },
      },
      id: 'shutdown-1',
      timestamp: '2026-03-30T02:15:00.000Z',
    });

    const entries = parseCopilotShutdownTokens(content, 'test-session-uuid');

    expect(entries).toHaveLength(2);

    const gpt = entries.find(e => e.model === 'gpt-5.4')!;
    expect(gpt.messageId).toBe('copilot:test-session-uuid:gpt-5.4');
    expect(gpt.inputTokens).toBe(3303725);
    expect(gpt.outputTokens).toBe(15480);
    expect(gpt.cacheReadTokens).toBe(2867968);
    expect(gpt.isFastMode).toBe(false);
    expect(gpt.timestamp).toBe('2026-03-30T02:15:00.000Z');
    expect(gpt.premiumRequests).toBe(5);

    const claude = entries.find(e => e.model === 'claude-sonnet-4.5')!;
    expect(claude.inputTokens).toBe(1327340);
    expect(claude.outputTokens).toBe(8483);
    expect(claude.premiumRequests).toBe(0);
  });

  it('handles shutdown with no modelMetrics', () => {
    const content = JSON.stringify({
      type: 'session.shutdown',
      data: { shutdownType: 'routine', totalPremiumRequests: 0 },
      id: 'shutdown-2',
      timestamp: '2026-03-30T00:00:00.000Z',
    });

    const entries = parseCopilotShutdownTokens(content, 'uuid');
    expect(entries).toHaveLength(0);
  });

  it('handles multiple shutdown events (resume scenario)', () => {
    const lines = [
      JSON.stringify({
        type: 'session.start',
        data: { sessionId: 'uuid' },
        id: 'start-1',
        timestamp: '2026-03-30T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          totalPremiumRequests: 2,
          modelMetrics: {
            'claude-haiku-4.5': {
              requests: { count: 5, cost: 2 },
              usage: { inputTokens: 10000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
            },
          },
        },
        id: 'shutdown-1',
        timestamp: '2026-03-30T01:00:00.000Z',
      }),
      JSON.stringify({
        type: 'session.resume',
        data: {},
        id: 'resume-1',
        timestamp: '2026-03-30T02:00:00.000Z',
      }),
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          totalPremiumRequests: 3,
          modelMetrics: {
            'claude-haiku-4.5': {
              requests: { count: 8, cost: 3 },
              usage: { inputTokens: 20000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
            },
          },
        },
        id: 'shutdown-2',
        timestamp: '2026-03-30T03:00:00.000Z',
      }),
    ].join('\n');

    const entries = parseCopilotShutdownTokens(lines, 'uuid');

    // Both shutdown events produce entries with the same messageId.
    // The scanner uses ON CONFLICT DO UPDATE, so the last (cumulative) values win.
    expect(entries).toHaveLength(2);
    // Last shutdown has the larger values
    expect(entries[1].inputTokens).toBe(20000);
    expect(entries[1].premiumRequests).toBe(3);
  });

  it('returns empty for content with no shutdown events', () => {
    const content = [
      JSON.stringify({ type: 'session.start', data: {}, id: '1', timestamp: '2026-03-30T00:00:00.000Z' }),
      JSON.stringify({ type: 'user.message', data: { content: 'hi' }, id: '2', timestamp: '2026-03-30T00:01:00.000Z' }),
    ].join('\n');

    const entries = parseCopilotShutdownTokens(content, 'uuid');
    expect(entries).toHaveLength(0);
  });

  it('skips malformed JSON lines', () => {
    const content = [
      '{"type":"session.shutdown"invalid json',
      JSON.stringify({
        type: 'session.shutdown',
        data: {
          totalPremiumRequests: 1,
          modelMetrics: {
            'gpt-5.4': { requests: { count: 1, cost: 1 }, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } },
          },
        },
        id: 'good',
        timestamp: '2026-03-30T00:00:00.000Z',
      }),
    ].join('\n');

    const entries = parseCopilotShutdownTokens(content, 'uuid');
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('gpt-5.4');
  });
});

describe('parseCopilotHumanMessages', () => {
  it('extracts human messages from user.message events', () => {
    const content = [
      JSON.stringify({
        type: 'user.message',
        data: { content: 'say hi', transformedContent: '<system>say hi</system>', attachments: [] },
        id: 'msg-1',
        timestamp: '2026-03-30T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant.message',
        data: { content: 'Hi!', outputTokens: 10 },
        id: 'msg-2',
        timestamp: '2026-03-30T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: 'look at the code and fix the bug', attachments: [] },
        id: 'msg-3',
        timestamp: '2026-03-30T00:01:00.000Z',
      }),
    ].join('\n');

    const entries = parseCopilotHumanMessages(content);

    expect(entries).toHaveLength(2);
    expect(entries[0].messageId).toBe('copilot:msg-1');
    expect(entries[0].textLength).toBe(6); // "say hi"
    expect(entries[0].wordCount).toBe(2);
    expect(entries[0].timestamp).toBe('2026-03-30T00:00:00.000Z');

    expect(entries[1].messageId).toBe('copilot:msg-3');
    expect(entries[1].textLength).toBe(32);
    expect(entries[1].wordCount).toBe(8);
  });

  it('skips user.message events with empty content', () => {
    const content = JSON.stringify({
      type: 'user.message',
      data: { content: '', attachments: [] },
      id: 'msg-empty',
      timestamp: '2026-03-30T00:00:00.000Z',
    });

    const entries = parseCopilotHumanMessages(content);
    expect(entries).toHaveLength(0);
  });

  it('skips events without id or timestamp', () => {
    const lines = [
      JSON.stringify({ type: 'user.message', data: { content: 'no id' }, timestamp: '2026-03-30T00:00:00.000Z' }),
      JSON.stringify({ type: 'user.message', data: { content: 'no ts' }, id: 'msg-1' }),
    ].join('\n');

    const entries = parseCopilotHumanMessages(lines);
    expect(entries).toHaveLength(0);
  });

  it('ignores non-user.message event types', () => {
    const content = [
      JSON.stringify({ type: 'session.start', data: {}, id: '1', timestamp: '2026-03-30T00:00:00.000Z' }),
      JSON.stringify({ type: 'assistant.message', data: { content: 'hi' }, id: '2', timestamp: '2026-03-30T00:00:00.000Z' }),
      JSON.stringify({ type: 'tool.execution_start', data: {}, id: '3', timestamp: '2026-03-30T00:00:00.000Z' }),
    ].join('\n');

    const entries = parseCopilotHumanMessages(content);
    expect(entries).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    const content = [
      'not valid json at all',
      JSON.stringify({
        type: 'user.message',
        data: { content: 'valid message' },
        id: 'msg-1',
        timestamp: '2026-03-30T00:00:00.000Z',
      }),
    ].join('\n');

    const entries = parseCopilotHumanMessages(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].textLength).toBe(13);
  });
});

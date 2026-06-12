import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../../src/main/db';
import { InputTracker } from '../../../src/main/trackers/input-tracker';
import type { ParsedHumanEntry } from '../../../src/main/trackers/jsonl-usage-parser';

function human(messageId: string, timestamp: string, text: string): ParsedHumanEntry {
  return {
    messageId,
    timestamp,
    text,
    textLength: text.length,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
  };
}

describe('InputTracker prompt history', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM human_input').run();
  });

  it('deduplicates recent prompts by normalized text and exposes usage metadata', () => {
    const tracker = new InputTracker();
    const repeated = 'Review and address high confidence issues';

    tracker.insertBatch([
      human('m1', '2026-06-11T10:00:00.000Z', repeated),
    ], 'session-1', '/repo/app', 'claude');
    tracker.insertBatch([
      human('m2', '2026-06-12T10:00:00.000Z', ` ${repeated.toLowerCase()}\n`),
    ], 'session-2', '/repo/lib', 'codex');
    tracker.insertBatch([
      human('m3', '2026-06-10T10:00:00.000Z', 'A different prompt'),
    ], 'session-3', '/repo/app', 'claude');

    const recent = tracker.recentPrompts(10);

    expect(recent).toHaveLength(2);
    const grouped = recent.find((entry) => entry.promptText.toLowerCase().includes(repeated.toLowerCase()));
    expect(grouped).toMatchObject({
      useCount: 2,
      firstUsedAt: '2026-06-11T10:00:00.000Z',
      lastUsedAt: '2026-06-12T10:00:00.000Z',
      projectCount: 2,
      providerCount: 2,
      isPinned: false,
    });
  });

  it('deduplicates search results too', () => {
    const tracker = new InputTracker();
    const prompt = 'Check if there are follow up clean ups';

    tracker.insertBatch([
      human('m1', '2026-06-11T10:00:00.000Z', prompt),
      human('m2', '2026-06-12T10:00:00.000Z', 'Check if there are follow\nup clean ups'),
      human('m3', '2026-06-12T11:00:00.000Z', 'commit the changes'),
    ], 'session-1', '/repo/app', 'claude');

    const results = tracker.searchPrompts('follow up', 10);

    expect(results).toHaveLength(1);
    expect(results[0].useCount).toBe(2);
  });

  it('applies pin and delete actions to the normalized prompt group', () => {
    const tracker = new InputTracker();
    const prompt = 'Merge into local main and delete the feature branch';

    tracker.insertBatch([
      human('m1', '2026-06-11T10:00:00.000Z', prompt),
      human('m2', '2026-06-12T10:00:00.000Z', `${prompt}\t`),
    ], 'session-1', '/repo/app', 'claude');

    const entry = tracker.recentPrompts(10)[0];
    tracker.togglePin(entry.id);
    expect(tracker.recentPrompts(10)[0]).toMatchObject({ isPinned: true, useCount: 2 });

    tracker.togglePin(tracker.recentPrompts(10)[0].id);
    expect(tracker.recentPrompts(10)[0]).toMatchObject({ isPinned: false, useCount: 2 });

    tracker.deletePrompt(tracker.recentPrompts(10)[0].id);
    expect(tracker.recentPrompts(10)).toEqual([]);

    const hidden = getDb().prepare('SELECT COUNT(*) AS count FROM human_input WHERE prompt_text IS NULL').get() as { count: number };
    expect(hidden.count).toBe(2);
  });
});

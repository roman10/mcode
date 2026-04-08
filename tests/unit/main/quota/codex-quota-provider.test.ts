import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { utimesSync } from 'node:fs';
import { CodexQuotaProvider } from '../../../../src/main/quota/codex-quota-provider';

describe('CodexQuotaProvider', () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), 'mcode-codex-quota-'));
    process.env.MCODE_CODEX_HOME = codexHome;
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
    delete process.env.MCODE_CODEX_HOME;
  });

  it('extracts the newest valid quota snapshot from rollout transcripts', async () => {
    const olderFile = createTranscriptFile('2026/03/26', 'older.jsonl', [
      '{"type":"event_msg","timestamp":"2026-03-26T00:00:00.000Z","payload":{"type":"token_count","info":{"rate_limits":{"limit_id":"codex","plan_type":"free","primary":{"used_percent":22,"window_minutes":10080,"resets_at":1775114749}}}}}',
    ]);
    const newerFile = createTranscriptFile('2026/03/27', 'newer.jsonl', [
      '{"type":"event_msg","timestamp":"2026-03-27T00:00:00.000Z","payload":{"type":"token_count","info":{"rate_limits":{"limit_id":"codex","plan_type":"plus","primary":{"used_percent":38,"window_minutes":10080,"resets_at":1776114749}}}}}',
    ]);
    utimesSync(olderFile, new Date('2026-03-26T00:00:00.000Z'), new Date('2026-03-26T00:00:00.000Z'));
    utimesSync(newerFile, new Date('2026-03-27T00:00:00.000Z'), new Date('2026-03-27T00:00:00.000Z'));

    const provider = new CodexQuotaProvider();
    const snapshots = await provider.getSnapshots(true);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].provider).toBe('codex');
    expect(snapshots[0].planType).toBe('plus');
    expect(snapshots[0].windows).toEqual([
      expect.objectContaining({
        id: 'primary',
        label: '1w',
        utilization: 38,
        windowMinutes: 10080,
      }),
    ]);
  });

  it('ignores malformed and quota-less token_count events', async () => {
    createTranscriptFile('2026/03/28', 'mixed.jsonl', [
      'not-json',
      '{"type":"event_msg","timestamp":"2026-03-28T00:00:00.000Z","payload":{"type":"token_count","info":null}}',
      '{"type":"event_msg","timestamp":"2026-03-28T00:01:00.000Z","payload":{"type":"token_count","info":{"rate_limits":{"plan_type":"free","primary":{"used_percent":55,"window_minutes":300,"resets_at":1777000000}}}}}',
    ]);

    const provider = new CodexQuotaProvider();
    const snapshots = await provider.getSnapshots(true);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].windows[0]).toEqual(expect.objectContaining({
      label: '5h',
      utilization: 55,
      windowMinutes: 300,
    }));
  });

  it('reads rate_limits at payload level (current Codex format)', async () => {
    createTranscriptFile('2026/04/08', 'current.jsonl', [
      '{"type":"event_msg","timestamp":"2026-04-08T03:51:46.391Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":491403}},"rate_limits":{"limit_id":"codex","plan_type":"free","primary":{"used_percent":92,"window_minutes":10080,"resets_at":1776149681}}}}',
    ]);

    const provider = new CodexQuotaProvider();
    const snapshots = await provider.getSnapshots(true);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].planType).toBe('free');
    expect(snapshots[0].windows).toEqual([
      expect.objectContaining({
        id: 'primary',
        label: '1w',
        utilization: 92,
        windowMinutes: 10080,
      }),
    ]);
  });

  function createTranscriptFile(dayPath: string, fileName: string, lines: string[]): string {
    const dir = join(codexHome, 'sessions', dayPath);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `rollout-${fileName}`);
    writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
  }
});

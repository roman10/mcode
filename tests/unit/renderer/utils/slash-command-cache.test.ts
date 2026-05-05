// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureSlashCommandsScan,
  getSlashCommandsCached,
  _resetSlashCommandCacheForTests,
} from '../../../../src/renderer/utils/slash-command-cache';
import type { SlashCommandEntry } from '../../../../src/shared/types';

interface MockGlobal {
  mcode: {
    slashCommands: { scan: ReturnType<typeof vi.fn> };
  };
}

function setScanResult(value: SlashCommandEntry[] | Promise<SlashCommandEntry[]>): ReturnType<typeof vi.fn> {
  const scan = vi.fn(() => (value instanceof Promise ? value : Promise.resolve(value)));
  (window as unknown as MockGlobal).mcode = {
    slashCommands: { scan },
  };
  return scan;
}

function entry(name: string): SlashCommandEntry {
  return { name, description: '', source: 'user' };
}

describe('slash-command-cache', () => {
  beforeEach(() => {
    _resetSlashCommandCacheForTests();
  });

  it('returns undefined from getSlashCommandsCached before any scan', () => {
    setScanResult([]);
    expect(getSlashCommandsCached('claude', '/repo')).toBeUndefined();
  });

  it('caches the scan result and lowercases names', async () => {
    setScanResult([entry('Foo'), entry('BAR')]);
    const set = await ensureSlashCommandsScan('claude', '/repo');
    expect(set).toEqual(new Set(['foo', 'bar']));
    expect(getSlashCommandsCached('claude', '/repo')).toBe(set);
  });

  it('dedupes concurrent scans for the same key into a single IPC call', async () => {
    let resolveScan: (cmds: SlashCommandEntry[]) => void = () => {};
    const pending = new Promise<SlashCommandEntry[]>((res) => { resolveScan = res; });
    const scan = setScanResult(pending);

    const p1 = ensureSlashCommandsScan('claude', '/repo');
    const p2 = ensureSlashCommandsScan('claude', '/repo');
    expect(scan).toHaveBeenCalledTimes(1);

    resolveScan([entry('alpha')]);
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
    expect(s1).toEqual(new Set(['alpha']));
  });

  it('keys cache by sessionType and cwd', async () => {
    const scan = setScanResult([entry('hi')]);
    await ensureSlashCommandsScan('claude', '/a');
    await ensureSlashCommandsScan('claude', '/b');
    await ensureSlashCommandsScan('codex', '/a');
    expect(scan).toHaveBeenCalledTimes(3);

    // Subsequent calls hit the cache.
    await ensureSlashCommandsScan('claude', '/a');
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it('does not cache errors so a later attempt can retry', async () => {
    const scan = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([entry('ok')]);
    (window as unknown as MockGlobal).mcode = {
      slashCommands: { scan },
    };

    const first = await ensureSlashCommandsScan('claude', '/repo');
    expect(first).toEqual(new Set());
    expect(getSlashCommandsCached('claude', '/repo')).toBeUndefined();

    const second = await ensureSlashCommandsScan('claude', '/repo');
    expect(second).toEqual(new Set(['ok']));
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

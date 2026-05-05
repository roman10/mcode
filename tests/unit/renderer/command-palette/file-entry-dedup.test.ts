import { describe, it, expect } from 'vitest';
import {
  dedupeFileEntries,
  type CwdFileResult,
} from '../../../../src/renderer/components/CommandPalette/file-entry-dedup';

describe('dedupeFileEntries', () => {
  it('returns one entry per absolute path when cwds duplicate the same root', () => {
    // Simulates the case where two cwd strings resolve to the same directory
    // (e.g. caller failed to normalize, or two backend roots point at the same place).
    const results: CwdFileResult[] = [
      { cwd: '/Users/feipeng/startup', files: ['blog/why.md', 'README.md'] },
      { cwd: '/Users/feipeng/startup', files: ['blog/why.md', 'README.md'] },
    ];
    const entries = dedupeFileEntries(results, null);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.path).sort()).toEqual(['README.md', 'blog/why.md']);
  });

  it('prefers the deepest cwd when the same file is reachable from a parent and child', () => {
    const results: CwdFileResult[] = [
      { cwd: '/Users/feipeng/startup', files: ['blog/why.md'] },
      { cwd: '/Users/feipeng/startup/blog', files: ['why.md'] },
    ];
    const entries = dedupeFileEntries(results, null);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'why.md',
      cwd: '/Users/feipeng/startup/blog',
      repo: 'blog',
    });
  });

  it('keeps files that exist only under a parent cwd', () => {
    const results: CwdFileResult[] = [
      { cwd: '/Users/feipeng/startup', files: ['top.md', 'blog/why.md'] },
      { cwd: '/Users/feipeng/startup/blog', files: ['why.md'] },
    ];
    const entries = dedupeFileEntries(results, null);
    expect(entries).toHaveLength(2);
    const top = entries.find((e) => e.path === 'top.md');
    expect(top).toMatchObject({ cwd: '/Users/feipeng/startup', repo: 'startup' });
    const why = entries.find((e) => e.path === 'why.md');
    expect(why).toMatchObject({ cwd: '/Users/feipeng/startup/blog', repo: 'blog' });
  });

  it('places entries from primaryCwd first', () => {
    const results: CwdFileResult[] = [
      { cwd: '/Users/feipeng/startup/blog', files: ['why.md'] },
      { cwd: '/Users/feipeng/startup/mcode', files: ['index.ts'] },
      { cwd: '/Users/feipeng/startup', files: ['top.md'] },
    ];
    const entries = dedupeFileEntries(results, '/Users/feipeng/startup');
    expect(entries[0]).toMatchObject({ path: 'top.md', cwd: '/Users/feipeng/startup' });
  });

  it('returns an empty array when given no results', () => {
    expect(dedupeFileEntries([], null)).toEqual([]);
    expect(dedupeFileEntries([], '/Users/feipeng/startup')).toEqual([]);
  });
});

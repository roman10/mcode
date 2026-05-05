import { describe, it, expect } from 'vitest';
import { basename, normalizeCwd } from '../../../../src/renderer/utils/path-utils';

describe('basename', () => {
  it('returns the last segment of an absolute path', () => {
    expect(basename('/Users/feipeng/startup')).toBe('startup');
  });

  it('returns the last segment when the path has a trailing slash', () => {
    expect(basename('/Users/feipeng/startup/')).toBe('startup');
  });

  it('returns the path itself when there is no slash', () => {
    expect(basename('startup')).toBe('startup');
  });

  it('returns empty for root, matching node:path semantics', () => {
    expect(basename('/')).toBe('');
  });
});

describe('normalizeCwd', () => {
  it('strips a trailing slash', () => {
    expect(normalizeCwd('/Users/feipeng/startup/')).toBe('/Users/feipeng/startup');
  });

  it('leaves a path without a trailing slash unchanged', () => {
    expect(normalizeCwd('/Users/feipeng/startup')).toBe('/Users/feipeng/startup');
  });

  it('leaves the root path unchanged', () => {
    expect(normalizeCwd('/')).toBe('/');
  });
});

import { describe, it, expect } from 'vitest';
import {
  filePathFromTileId,
  diffPathFromTileId,
  commitDiffFromTileId,
  FILE_TILE_PREFIX,
  DIFF_TILE_PREFIX,
  COMMIT_DIFF_TILE_PREFIX,
} from '../../../../src/renderer/utils/tile-id';

describe('filePathFromTileId', () => {
  it('extracts file path from a file tile ID', () => {
    expect(filePathFromTileId(`${FILE_TILE_PREFIX}/Users/test/file.ts`)).toBe('/Users/test/file.ts');
  });

  it('returns null for non-file tile IDs', () => {
    expect(filePathFromTileId('session-123')).toBeNull();
    expect(filePathFromTileId(`${DIFF_TILE_PREFIX}/path`)).toBeNull();
    expect(filePathFromTileId('')).toBeNull();
  });

  it('handles paths with colons', () => {
    expect(filePathFromTileId(`${FILE_TILE_PREFIX}C:\\Users\\file.ts`)).toBe('C:\\Users\\file.ts');
  });
});

describe('diffPathFromTileId', () => {
  it('extracts file path from a diff tile ID', () => {
    expect(diffPathFromTileId(`${DIFF_TILE_PREFIX}/Users/test/file.ts`)).toBe('/Users/test/file.ts');
  });

  it('returns null for non-diff tile IDs', () => {
    expect(diffPathFromTileId('session-123')).toBeNull();
    expect(diffPathFromTileId(`${FILE_TILE_PREFIX}/path`)).toBeNull();
  });
});

describe('commitDiffFromTileId', () => {
  it('parses commit hash and file path', () => {
    const result = commitDiffFromTileId(`${COMMIT_DIFF_TILE_PREFIX}abc1234:/Users/test/file.ts`);
    expect(result).toEqual({
      commitHash: 'abc1234',
      absolutePath: '/Users/test/file.ts',
    });
  });

  it('returns null for non-commit-diff tile IDs', () => {
    expect(commitDiffFromTileId('session-123')).toBeNull();
    expect(commitDiffFromTileId(`${FILE_TILE_PREFIX}/path`)).toBeNull();
  });

  it('returns null when no colon separator in the rest', () => {
    expect(commitDiffFromTileId(`${COMMIT_DIFF_TILE_PREFIX}abc1234`)).toBeNull();
  });

  it('handles file paths with colons', () => {
    const result = commitDiffFromTileId(`${COMMIT_DIFF_TILE_PREFIX}abc1234:C:\\Users\\file.ts`);
    expect(result).toEqual({
      commitHash: 'abc1234',
      absolutePath: 'C:\\Users\\file.ts',
    });
  });
});

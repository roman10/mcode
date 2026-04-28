export const FILE_TILE_PREFIX = 'file:';
export const DIFF_TILE_PREFIX = 'diff:';
export const COMMIT_DIFF_TILE_PREFIX = 'commit-diff:';

export function filePathFromTileId(tile: string): string | null {
  if (tile.startsWith(FILE_TILE_PREFIX)) {
    return tile.slice(FILE_TILE_PREFIX.length);
  }
  return null;
}

export function diffPathFromTileId(tile: string): string | null {
  if (tile.startsWith(DIFF_TILE_PREFIX)) {
    return tile.slice(DIFF_TILE_PREFIX.length);
  }
  return null;
}

/** Parse a commit-diff tile ID: "commit-diff:<hash>:<absolutePath>" */
export function commitDiffFromTileId(tile: string): { commitHash: string; absolutePath: string } | null {
  if (!tile.startsWith(COMMIT_DIFF_TILE_PREFIX)) return null;
  const rest = tile.slice(COMMIT_DIFF_TILE_PREFIX.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx < 0) return null;
  return {
    commitHash: rest.slice(0, colonIdx),
    absolutePath: rest.slice(colonIdx + 1),
  };
}

export function sessionIdFromTileId(tile: string): string | null {
  if (tile.startsWith('session:')) {
    return tile.slice('session:'.length);
  }
  return null;
}

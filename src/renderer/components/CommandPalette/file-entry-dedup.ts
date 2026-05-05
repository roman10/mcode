import { basename } from '../../utils/path-utils';

export interface FileEntry {
  path: string;
  cwd: string;
  repo: string;
}

export interface CwdFileResult {
  cwd: string;
  files: string[];
}

// Dedup by absolute path; deepest cwd wins so the more specific repo tag is shown.
export function dedupeFileEntries(
  results: readonly CwdFileResult[],
  primaryCwd: string | null,
): FileEntry[] {
  const byAbs = new Map<string, FileEntry>();
  for (const { cwd, files } of results) {
    const repo = basename(cwd);
    for (const path of files) {
      const abs = `${cwd}/${path}`;
      const existing = byAbs.get(abs);
      if (!existing || cwd.length > existing.cwd.length) {
        byAbs.set(abs, { path, cwd, repo });
      }
    }
  }
  const entries = [...byAbs.values()];
  if (primaryCwd) {
    entries.sort((a, b) => {
      const aPrim = a.cwd === primaryCwd ? 0 : 1;
      const bPrim = b.cwd === primaryCwd ? 0 : 1;
      return aPrim - bPrim;
    });
  }
  return entries;
}

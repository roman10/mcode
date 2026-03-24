// --- Git Changes ---

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface GitChangedFile {
  path: string;           // relative to repo root
  status: GitFileStatus;
  oldPath?: string;       // for renamed files
}

export interface GitStatusResult {
  repoRoot: string;
  staged: GitChangedFile[];    // index area (X column in porcelain)
  unstaged: GitChangedFile[];  // worktree area (Y column in porcelain) + untracked
}

export type GitDiffContent =
  | { binary: false; originalContent: string; modifiedContent: string; language: string }
  | { binary: true };

// --- Git Commit Graph ---

export interface CommitGraphNode {
  hash: string;
  shortHash: string;
  parents: string[];
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string; // ISO 8601
  refs: string[];      // branch/tag names pointing to this commit
  isClaudeAssisted: boolean;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

export interface CommitGraphResult {
  repoRoot: string;
  commits: CommitGraphNode[];
  hasMore: boolean;
}

export interface CommitFileEntry {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  insertions: number;
  deletions: number;
}

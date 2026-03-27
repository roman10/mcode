import type {
  CommitFileEntry,
  CommitGraphResult,
  GitDiffContent,
  GitStatusResult,
} from './types';

// ---------------------------------------------------------------------------
// Git domain IPC channels
// ---------------------------------------------------------------------------

export interface GitInvokeContract {
  'git:status':                         { params: [cwd: string]; result: GitStatusResult };
  'git:diff-content':                   { params: [cwd: string, filePath: string]; result: GitDiffContent };
  'git:all-statuses':                   { params: []; result: GitStatusResult[] };
  'git:graph-log':                      { params: [repoPath: string, limit?: number, offset?: number]; result: CommitGraphResult };
  'git:tracked-repos':                  { params: []; result: string[] };
  'git:commit-files':                   { params: [repoPath: string, commitHash: string]; result: CommitFileEntry[] };
  'git:commit-file-diff':               { params: [repoPath: string, commitHash: string, filePath: string]; result: GitDiffContent };
  'git:stage-file':                     { params: [repoRoot: string, filePath: string]; result: void };
  'git:unstage-file':                   { params: [repoRoot: string, filePath: string]; result: void };
  'git:discard-file':                   { params: [repoRoot: string, filePath: string, isUntracked: boolean]; result: void };
  'git:stage-all':                      { params: [repoRoot: string]; result: void };
  'git:unstage-all':                    { params: [repoRoot: string]; result: void };
  'git:discard-all':                    { params: [repoRoot: string]; result: void };
}

export interface GitPushContract {
  'git:status-changed':                 { params: [] };
}

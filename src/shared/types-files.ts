// --- Files ---

export interface FileListResult {
  files: string[];
  dirs: string[];
  isGitRepo: boolean;
}

export type FileReadResult =
  | { content: string; language: string }
  | { isBinary: true }
  | { isTooLarge: true };

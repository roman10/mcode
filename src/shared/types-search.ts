// --- File Search ---

export interface FileSearchMatch {
  path: string;        // relative to repo root
  line: number;
  column: number;
  matchLength: number;
  lineContent: string;
}

export interface FileSearchRequest {
  id: string;
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  cwds: string[];      // session cwds to search across
  maxResults?: number;  // default 500
}

export type SearchEvent =
  | { type: 'progress'; searchId: string; repoPath: string; repoName: string; matches: FileSearchMatch[] }
  | { type: 'complete'; searchId: string; totalMatches: number; totalFiles: number; truncated: boolean; durationMs: number }
  | { type: 'error'; searchId: string; message: string };

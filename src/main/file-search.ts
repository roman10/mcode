import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import type { FileSearchMatch, FileSearchRequest, SearchEvent } from '../shared/types';
import { typedHandle } from './ipc-helpers';

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 5_000;
const BATCH_INTERVAL_MS = 50;
const DEFAULT_MAX_RESULTS = 500;
const MAX_COUNT_PER_FILE = 100;

/** Resolve the ripgrep binary path, handling asar-unpacked in packaged builds. */
function resolveRgPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw: string = require('@vscode/ripgrep').rgPath;
    const resolved = raw.replace('app.asar', 'app.asar.unpacked');
    return existsSync(resolved) ? resolved : null;
  } catch {
    // Fall back to system rg if @vscode/ripgrep is not available
    return null;
  }
}

/** Find ripgrep: prefer bundled, fall back to system PATH. */
function findRgPath(): string {
  const bundled = resolveRgPath();
  if (bundled) return bundled;
  return 'rg'; // rely on system PATH
}

export class FileSearch {
  private rgPath: string;
  private activeSearches = new Map<string, ChildProcess[]>();
  private repoRootCache = new Map<string, string>();
  private listeners = new Set<(event: SearchEvent) => void>();

  constructor() {
    this.rgPath = findRgPath();
  }

  /** Add a listener for search events. Returns a dispose function. */
  addListener(listener: (event: SearchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Start a search. Returns the search ID. */
  async search(request: FileSearchRequest): Promise<string> {
    const { id: searchId, query, isRegex, caseSensitive, cwds, maxResults = DEFAULT_MAX_RESULTS } = request;

    // Cancel any existing search with this ID
    this.cancel(searchId);

    if (!query) {
      this.emit({ type: 'complete', searchId, totalMatches: 0, totalFiles: 0, truncated: false, durationMs: 0 });
      return searchId;
    }

    const startTime = Date.now();

    // Filter out overly broad directories (e.g. home dir from auth terminal sessions)
    const home = homedir();
    const filteredCwds = cwds.filter((cwd) => cwd !== home && existsSync(cwd));

    // Deduplicate cwds by git root
    const repoRoots = await this.deduplicateByGitRoot(filteredCwds);
    if (repoRoots.length === 0) {
      this.emit({ type: 'complete', searchId, totalMatches: 0, totalFiles: 0, truncated: false, durationMs: 0 });
      return searchId;
    }

    const processes: ChildProcess[] = [];
    this.activeSearches.set(searchId, processes);

    let totalMatches = 0;
    let totalFiles = 0;
    let truncated = false;
    let completedCount = 0;

    const checkAllDone = (): void => {
      completedCount++;
      if (completedCount === repoRoots.length) {
        this.activeSearches.delete(searchId);
        this.emit({
          type: 'complete',
          searchId,
          totalMatches,
          totalFiles,
          truncated,
          durationMs: Date.now() - startTime,
        });
      }
    };

    for (const { root, name } of repoRoots) {
      if (truncated) {
        checkAllDone();
        continue;
      }

      const args = this.buildRgArgs(query, isRegex, caseSensitive);
      const child = spawn(this.rgPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      processes.push(child);

      // Parse NDJSON output, batch results
      const rl = createInterface({ input: child.stdout! });
      let batch: FileSearchMatch[] = [];
      let batchTimer: ReturnType<typeof setTimeout> | null = null;
      const filesInRepo = new Set<string>();

      const flushBatch = (): void => {
        if (batch.length === 0) return;
        const toSend = batch;
        batch = [];
        batchTimer = null;
        this.emit({ type: 'progress', searchId, repoPath: root, repoName: name, matches: toSend });
      };

      rl.on('line', (line) => {
        if (totalMatches >= maxResults) {
          truncated = true;
          child.kill();
          return;
        }

        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match') {
            const match = this.parseRgMatch(obj);
            if (match) {
              batch.push(match);
              totalMatches++;
              filesInRepo.add(match.path);
              if (!batchTimer) {
                batchTimer = setTimeout(flushBatch, BATCH_INTERVAL_MS);
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      });

      child.on('close', () => {
        if (batchTimer) clearTimeout(batchTimer);
        flushBatch();
        totalFiles += filesInRepo.size;
        checkAllDone();
      });

      // 'close' always fires after 'error' (including ENOENT), so checkAllDone is called via the close handler.
      child.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        const message = code === 'ENOENT' && this.rgPath === 'rg'
          ? 'ripgrep (rg) not found. Install with: brew install ripgrep'
          : err.message;
        this.emit({ type: 'error', searchId, message });
      });
    }

    return searchId;
  }

  /** Cancel an active search. */
  cancel(searchId: string): void {
    const processes = this.activeSearches.get(searchId);
    if (!processes) return;
    for (const child of processes) {
      if (!child.killed) child.kill();
    }
    this.activeSearches.delete(searchId);
  }

  /** Cancel all active searches (e.g., on app quit). */
  cancelAll(): void {
    for (const [id] of this.activeSearches) {
      this.cancel(id);
    }
  }

  private emit(event: SearchEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private buildRgArgs(query: string, isRegex: boolean, caseSensitive: boolean): string[] {
    const args = [
      '--json',
      '--line-number',
      '--column',
      '--max-filesize', '1M',
      '--max-count', String(MAX_COUNT_PER_FILE),
      '--hidden',
    ];
    if (!caseSensitive) args.push('-i');
    if (isRegex) {
      args.push('-e', query);
    } else {
      args.push('-F', '--', query);
    }
    args.push('.'); // search from cwd root
    return args;
  }

  private parseRgMatch(obj: RgMatchMessage): FileSearchMatch | null {
    try {
      const path: string = obj.data.path.text;
      const lineNumber: number = obj.data.line_number;
      const lineText: string = obj.data.lines.text.replace(/\n$/, '');
      const submatches = obj.data.submatches;
      if (!submatches || submatches.length === 0) return null;
      const firstMatch = submatches[0];
      return {
        path,
        line: lineNumber,
        column: firstMatch.start + 1, // 1-based
        matchLength: firstMatch.end - firstMatch.start,
        lineContent: lineText,
      };
    } catch {
      return null;
    }
  }

  /** Deduplicate cwds to unique git roots. Non-git dirs searched directly. */
  private async deduplicateByGitRoot(cwds: string[]): Promise<{ root: string; name: string }[]> {
    const seen = new Map<string, string>(); // root → name
    for (const cwd of cwds) {
      const root = await this.getGitRoot(cwd);
      if (!seen.has(root)) {
        seen.set(root, basename(root));
      }
    }
    return [...seen.entries()].map(([root, name]) => ({ root, name }));
  }

  /** Resolve the git root for a directory, or return the directory itself for non-git dirs. */
  private async getGitRoot(cwd: string): Promise<string> {
    const cached = this.repoRootCache.get(cwd);
    if (cached !== undefined) return cached;

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
      );
      const root = stdout.trim();
      this.repoRootCache.set(cwd, root);
      return root;
    } catch {
      this.repoRootCache.set(cwd, cwd);
      return cwd;
    }
  }
}

// --- Ripgrep JSON types (subset we parse) ---

export function registerSearchIpc(fileSearch: FileSearch): void {
  typedHandle('search:start', (request) => {
    return fileSearch.search(request);
  });

  typedHandle('search:cancel', (searchId) => {
    fileSearch.cancel(searchId);
  });
}

// --- Ripgrep JSON types (subset we parse) ---

interface RgMatchMessage {
  type: 'match';
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
  };
}

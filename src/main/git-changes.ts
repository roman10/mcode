import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { promisify } from 'node:util';
import type { SessionManager } from './session-manager';
import type { GitChangedFile, GitFileStatus, GitStatusResult, GitDiffContent } from '../shared/types';

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 10_000;
const BINARY_CHECK_SIZE = 8_192;

// Map file extension to language identifier for CodeMirror
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.md': 'markdown', '.mdx': 'markdown',
  '.py': 'python', '.rs': 'rust', '.go': 'go',
  '.java': 'java', '.kt': 'kotlin', '.rb': 'ruby',
  '.php': 'php', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.sql': 'sql', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.svg': 'xml', '.vue': 'vue',
};

function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? '';
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLen = Math.min(buffer.length, BINARY_CHECK_SIZE);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Parse a single file entry from `git status --porcelain=v1` output. */
function parseStatusLine(line: string): GitChangedFile | null {
  if (line.length < 4) return null;

  const x = line[0]; // index status
  const y = line[1]; // worktree status
  const rest = line.slice(3);

  // Determine status: prefer worktree status (uncommitted), fall back to index
  let status: GitFileStatus;
  const code = y !== ' ' ? y : x;

  switch (code) {
    case 'M': status = 'modified'; break;
    case 'A': status = 'added'; break;
    case 'D': status = 'deleted'; break;
    case 'R': status = 'renamed'; break;
    case '?': status = 'untracked'; break;
    default: status = 'modified'; break;
  }

  // Handle renamed files: "old -> new"
  if (x === 'R' || y === 'R') {
    const arrow = rest.indexOf(' -> ');
    if (arrow >= 0) {
      return {
        path: rest.slice(arrow + 4),
        status: 'renamed',
        oldPath: rest.slice(0, arrow),
      };
    }
  }

  return { path: rest, status };
}

export class GitChangesService {
  private sessionManager: SessionManager;
  private repoRootCache = new Map<string, string | null>();

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /** Resolve cwd to git repo root. Cached. */
  private async resolveRepoRoot(cwd: string): Promise<string | null> {
    if (this.repoRootCache.has(cwd)) {
      return this.repoRootCache.get(cwd)!;
    }

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
      this.repoRootCache.set(cwd, null);
      return null;
    }
  }

  /** Get git status for a specific working directory. */
  async getStatus(cwd: string): Promise<GitStatusResult> {
    const repoRoot = await this.resolveRepoRoot(cwd);
    if (!repoRoot) {
      return { repoRoot: cwd, files: [] };
    }

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain=v1'],
        { cwd: repoRoot, timeout: GIT_COMMAND_TIMEOUT_MS },
      );

      const files: GitChangedFile[] = [];
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        const parsed = parseStatusLine(line);
        if (parsed) files.push(parsed);
      }

      return { repoRoot, files };
    } catch {
      return { repoRoot, files: [] };
    }
  }

  /** Get diff content (original + modified) for a specific file.
   *  filePath can be absolute or relative to cwd. */
  async getDiffContent(cwd: string, filePath: string): Promise<GitDiffContent> {
    const repoRoot = await this.resolveRepoRoot(cwd);
    if (!repoRoot) {
      return { binary: false, originalContent: '', modifiedContent: '', language: inferLanguage(filePath) };
    }

    // Resolve to absolute, then compute relative to repo root
    const absolutePath = resolve(cwd, filePath);
    const relativePath = absolutePath.startsWith(repoRoot + '/')
      ? absolutePath.slice(repoRoot.length + 1)
      : filePath;
    const language = inferLanguage(absolutePath);

    // Get original content from HEAD
    let originalContent = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `HEAD:${relativePath}`],
        { cwd: repoRoot, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );
      originalContent = stdout;
    } catch {
      // File doesn't exist in HEAD (new/untracked file) — originalContent stays empty
    }

    // Get modified content from working tree
    let modifiedContent = '';
    try {
      const buffer = await readFile(absolutePath);
      if (isBinaryBuffer(buffer)) {
        return { binary: true };
      }
      modifiedContent = buffer.toString('utf-8');
    } catch {
      // File was deleted — modifiedContent stays empty
    }

    return { binary: false, originalContent, modifiedContent, language };
  }

  /** Get statuses for all repos across active sessions. Deduplicates by repo root. */
  async getAllStatuses(): Promise<GitStatusResult[]> {
    const cwds = this.sessionManager.getDistinctClaudeCwds();
    const seen = new Set<string>();
    const results: GitStatusResult[] = [];

    for (const cwd of cwds) {
      const repoRoot = await this.resolveRepoRoot(cwd);
      if (!repoRoot || seen.has(repoRoot)) continue;
      seen.add(repoRoot);

      const status = await this.getStatus(repoRoot);
      if (status.files.length > 0) {
        results.push(status);
      }
    }

    return results;
  }
}

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { promisify } from 'node:util';
import type { SessionManager } from './session-manager';
import type { GitChangedFile, GitFileStatus, GitStatusResult, GitDiffContent, CommitGraphNode, CommitGraphResult, CommitFileEntry } from '../shared/types';

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

  /** Get distinct tracked repo roots from all session cwds. */
  async getTrackedRepos(): Promise<string[]> {
    const cwds = this.sessionManager.getDistinctClaudeCwds();
    const repos = new Set<string>();

    for (const cwd of cwds) {
      const repoRoot = await this.resolveRepoRoot(cwd);
      if (repoRoot) repos.add(repoRoot);
    }

    return [...repos];
  }

  /** Get commit graph log for a repo. Runs git log with topology info. */
  async getGraphLog(repoPath: string, limit = 50, offset = 0): Promise<CommitGraphResult> {
    try {
      // Use newline-separated fields with a record separator to avoid delimiter conflicts
      const SEP = 'GRAPH_RECORD';
      const { stdout } = await execFileAsync(
        'git',
        [
          'log',
          '--all',
          '--topo-order',
          `--format=${SEP}%n%H%n%P%n%h%n%s%n%an%n%ae%n%aI%n%d`,
          `--skip=${offset}`,
          `-n`, `${limit + 1}`,
        ],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );

      const blocks = stdout.split(SEP + '\n').filter(Boolean);
      const hasMore = blocks.length > limit;
      const commitBlocks = hasMore ? blocks.slice(0, limit) : blocks;

      const commits: CommitGraphNode[] = [];
      for (const block of commitBlocks) {
        const lines = block.split('\n');
        if (lines.length < 7) continue;

        const hash = lines[0]?.trim() ?? '';
        if (!hash || hash.length < 7) continue;

        const parentStr = lines[1]?.trim() ?? '';
        const shortHash = lines[2]?.trim() ?? '';
        const message = lines[3] ?? '';
        const authorName = lines[4] ?? '';
        const authorEmail = lines[5] ?? '';
        const committedAt = lines[6] ?? '';
        const refsRaw = lines[7]?.trim() ?? '';

        const parents = parentStr ? parentStr.split(' ').filter(Boolean) : [];
        const refs = parseRefs(refsRaw);

        commits.push({
          hash,
          shortHash,
          parents,
          message,
          authorName,
          authorEmail,
          committedAt,
          refs,
          isClaudeAssisted: false,
          filesChanged: null,
          insertions: null,
          deletions: null,
        });
      }

      return { repoRoot: repoPath, commits, hasMore };
    } catch {
      return { repoRoot: repoPath, commits: [], hasMore: false };
    }
  }

  /** Get list of files changed in a specific commit. */
  async getCommitFiles(repoPath: string, commitHash: string): Promise<CommitFileEntry[]> {
    try {
      // Use diff-tree for the commit's changes; handle root commit (no parent)
      const { stdout } = await execFileAsync(
        'git',
        ['diff-tree', '--no-commit-id', '-r', '--numstat', '--diff-filter=ADMR', '-z', commitHash],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );

      // Also get the status letters
      const { stdout: statusOut } = await execFileAsync(
        'git',
        ['diff-tree', '--no-commit-id', '-r', '--name-status', commitHash],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );

      // Parse status output: each line is "STATUS\tPATH"
      const statusMap = new Map<string, 'A' | 'M' | 'D' | 'R'>();
      for (const line of statusOut.split('\n')) {
        if (!line) continue;
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const code = line[0] as 'A' | 'M' | 'D' | 'R';
        const path = line.slice(tab + 1);
        statusMap.set(path, code);
      }

      // Parse numstat output (null-separated when using -z): "insertions\tdeletions\tpath\0"
      const entries: CommitFileEntry[] = [];
      const parts = stdout.split('\0').filter(Boolean);
      for (const part of parts) {
        const fields = part.split('\t');
        if (fields.length < 3) continue;
        const ins = fields[0] === '-' ? 0 : parseInt(fields[0], 10);
        const del = fields[1] === '-' ? 0 : parseInt(fields[1], 10);
        const path = fields[2];
        entries.push({
          path,
          status: statusMap.get(path) ?? 'M',
          insertions: ins,
          deletions: del,
        });
      }

      return entries;
    } catch {
      return [];
    }
  }

  /** Get diff content for a specific file at a specific commit. */
  async getCommitFileDiff(repoPath: string, commitHash: string, filePath: string): Promise<GitDiffContent> {
    const language = inferLanguage(filePath);

    // Get content at commit (after)
    let modifiedContent = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `${commitHash}:${filePath}`],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );
      modifiedContent = stdout;
    } catch {
      // File was deleted in this commit
    }

    // Get content at parent (before)
    let originalContent = '';
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `${commitHash}~1:${filePath}`],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );
      originalContent = stdout;
    } catch {
      // File was added in this commit (no parent version)
    }

    // Check for binary content
    const check = modifiedContent || originalContent;
    if (check && isBinaryBuffer(Buffer.from(check.slice(0, BINARY_CHECK_SIZE)))) {
      return { binary: true };
    }

    return { binary: false, originalContent, modifiedContent, language };
  }
}

/** Parse git decoration string like " (HEAD -> main, origin/main, tag: v1.0)" into ref names. */
function parseRefs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Remove outer parens: " (HEAD -> main, origin/main)" → "HEAD -> main, origin/main"
  const inner = trimmed.replace(/^\(/, '').replace(/\)$/, '').trim();
  if (!inner) return [];

  return inner.split(',').map((ref) => {
    let r = ref.trim();
    // "HEAD -> main" → "main"
    const arrow = r.indexOf(' -> ');
    if (arrow >= 0) r = r.slice(arrow + 4);
    // "tag: v1.0" → "v1.0"
    if (r.startsWith('tag: ')) r = r.slice(5);
    return r.trim();
  }).filter(Boolean);
}

import { execFile } from 'node:child_process';
import { readFile, writeFile as fsWriteFile, stat } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import fg from 'fast-glob';
import type { FileListResult, FileReadResult } from '../shared/types';
import { typedHandle } from './ipc-helpers';

export type { FileListResult, FileReadResult };

const CACHE_TTL_MS = 30_000;
const MAX_FILES = 50_000;
const MAX_FILE_SIZE = 1_024 * 1_024; // 1 MB
const BINARY_CHECK_SIZE = 8_192;

const DEFAULT_IGNORE = [
  'node_modules/**',
  '.git/**',
  '.DS_Store',
  '*.lock',
  'dist/**',
  'build/**',
  'coverage/**',
  '.next/**',
  '.nuxt/**',
  '__pycache__/**',
  '*.pyc',
  '.venv/**',
  'vendor/**',
];

// Map file extension to language identifier for CodeMirror
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'xml',
  '.vue': 'vue',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.scala': 'scala',
  '.clj': 'clojure',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.dart': 'dart',
  '.proto': 'protobuf',
  '.dockerfile': 'dockerfile',
  '.tf': 'hcl',
};

// Special filenames that have a known language
const FILENAME_TO_LANG: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'shell',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  '.gitignore': 'shell',
  '.env': 'shell',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
};

interface CacheEntry {
  files: string[];
  isGitRepo: boolean;
  timestamp: number;
}

function inferLanguage(filePath: string): string {
  const name = basename(filePath);
  if (FILENAME_TO_LANG[name]) return FILENAME_TO_LANG[name];
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

export class FileLister {
  private cache = new Map<string, CacheEntry>();

  async listFiles(cwd: string): Promise<FileListResult> {
    const resolved = resolve(cwd);
    const cached = this.cache.get(resolved);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { files: cached.files, isGitRepo: cached.isGitRepo };
    }

    // Try git ls-files first
    try {
      const files = await this.gitListFiles(resolved);
      const entry: CacheEntry = {
        files: files.slice(0, MAX_FILES),
        isGitRepo: true,
        timestamp: Date.now(),
      };
      this.cache.set(resolved, entry);
      return { files: entry.files, isGitRepo: true };
    } catch {
      // Not a git repo or git not available — fall back to fast-glob
    }

    const files = await fg('**/*', {
      cwd: resolved,
      ignore: DEFAULT_IGNORE,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    const capped = files.slice(0, MAX_FILES);
    const entry: CacheEntry = {
      files: capped,
      isGitRepo: false,
      timestamp: Date.now(),
    };
    this.cache.set(resolved, entry);
    return { files: capped, isGitRepo: false };
  }

  async readFile(cwd: string, relativePath: string): Promise<FileReadResult> {
    const resolvedCwd = resolve(cwd);
    const resolved = resolve(resolvedCwd, relativePath);

    // Path traversal guard: ensure resolved path is within cwd
    if (!resolved.startsWith(resolvedCwd + '/')) {
      throw new Error('Path traversal detected');
    }

    const info = await stat(resolved);
    if (info.size > MAX_FILE_SIZE) {
      return { isTooLarge: true };
    }

    const buffer = await readFile(resolved);
    if (isBinaryBuffer(buffer)) {
      return { isBinary: true };
    }

    return {
      content: buffer.toString('utf-8'),
      language: inferLanguage(relativePath),
    };
  }

  async writeFile(cwd: string, relativePath: string, content: string): Promise<void> {
    const resolvedCwd = resolve(cwd);
    const resolved = resolve(resolvedCwd, relativePath);

    if (!resolved.startsWith(resolvedCwd + '/')) {
      throw new Error('Path traversal detected');
    }

    await fsWriteFile(resolved, content, 'utf-8');
  }

  invalidateCache(cwd: string): void {
    this.cache.delete(resolve(cwd));
  }

  private gitListFiles(cwd: string): Promise<string[]> {
    return new Promise((ok, fail) => {
      execFile(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            fail(error);
            return;
          }
          const files = stdout
            .split('\n')
            .filter((line) => line.length > 0);
          ok(files);
        },
      );
    });
  }
}

export function registerFileIpc(fileLister: FileLister): void {
  typedHandle('files:list', (cwd) => {
    return fileLister.listFiles(cwd);
  });

  typedHandle('files:read', (cwd, relativePath) => {
    return fileLister.readFile(cwd, relativePath);
  });

  typedHandle('files:write', (cwd, relativePath, content) => {
    return fileLister.writeFile(cwd, relativePath, content);
  });
}

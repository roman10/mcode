import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CodexThreadRecord {
  id: string;
  cwd: string;
  title: string;
  firstUserMessage: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CodexThreadMatchInput {
  cwd: string;
  initialPrompt?: string;
  startedAtMs: number;
  nowMs: number;
  claimedThreadIds: Set<string>;
}

interface CodexThreadRow {
  id: string;
  cwd: string;
  title: string;
  first_user_message: string;
  created_at: number;
  updated_at: number;
}

export function resolveCodexStateDbPath(): string | null {
  const directPath = process.env['MCODE_CODEX_STATE_DB'];
  if (directPath) {
    return existsSync(directPath) ? directPath : null;
  }

  const codexHome = process.env['MCODE_CODEX_HOME'] ?? join(homedir(), '.codex');
  if (!existsSync(codexHome)) return null;

  const files = readdirSync(codexHome)
    .filter((name) => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  if (files.length === 0) return null;
  return join(codexHome, files[0]);
}

export function selectCodexThreadCandidate(
  threads: CodexThreadRecord[],
  input: CodexThreadMatchInput,
): CodexThreadRecord | null {
  const lowerBoundMs = input.startedAtMs - 5_000;
  const upperBoundMs = input.nowMs + 1_000;

  const eligible = threads.filter((thread) =>
    thread.cwd === input.cwd
    && !input.claimedThreadIds.has(thread.id)
    && thread.createdAtMs >= lowerBoundMs
    && thread.createdAtMs <= upperBoundMs,
  );

  const exactPromptMatches = input.initialPrompt
    ? eligible.filter((thread) => thread.firstUserMessage === input.initialPrompt)
    : [];
  if (exactPromptMatches.length === 1) return exactPromptMatches[0];
  if (exactPromptMatches.length > 1) return null;

  const exactTitleMatches = input.initialPrompt
    ? eligible.filter((thread) => thread.title === input.initialPrompt)
    : [];
  if (exactTitleMatches.length === 1) return exactTitleMatches[0];
  if (exactTitleMatches.length > 1) return null;

  if (eligible.length === 1) return eligible[0];
  return null;
}

export function findCodexThreadMatch(input: CodexThreadMatchInput): CodexThreadRecord | null {
  const dbPath = resolveCodexStateDbPath();
  if (!dbPath) return null;

  const lowerBoundSec = Math.floor((input.startedAtMs - 5_000) / 1000);
  const upperBoundSec = Math.floor((input.nowMs + 1_000) / 1000);

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT id, cwd, title, first_user_message, created_at, updated_at
       FROM threads
       WHERE archived = 0
         AND cwd = ?
         AND created_at >= ?
         AND created_at <= ?
       ORDER BY created_at DESC
       LIMIT 10`,
    ).all(input.cwd, lowerBoundSec, upperBoundSec) as CodexThreadRow[];

    return selectCodexThreadCandidate(
      rows.map((row) => ({
        id: row.id,
        cwd: row.cwd,
        title: row.title ?? '',
        firstUserMessage: row.first_user_message ?? '',
        createdAtMs: row.created_at * 1000,
        updatedAtMs: row.updated_at * 1000,
      })),
      input,
    );
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

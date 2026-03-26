import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WebContents } from 'electron';
import type { SessionManager } from './session-manager';
import { getDb } from './db';
import { getPreferenceBool } from './preferences';
import { logger } from './logger';
import { typedHandle } from './ipc-helpers';
import type {
  HookEvent,
  DailyCommitStats,
  CommitHeatmapEntry,
  CommitStreakInfo,
  CommitCadenceInfo,
  CommitWeeklyTrend,
} from '../shared/types';

const execFileAsync = promisify(execFile);

const BACKGROUND_POLL_MS = 5 * 60 * 1000; // 5 minutes
const COMMIT_BACKFILL_DAYS = 90;
const GIT_COMMAND_TIMEOUT_MS = 10_000;

// Hook event tool_input keywords that indicate a potential commit
const GIT_COMMIT_KEYWORDS = ['commit', 'merge', 'cherry-pick', 'rebase'];

// Conventional commit type prefixes
const COMMIT_TYPE_PREFIXES: Record<string, string> = {
  feat: 'feat',
  fix: 'fix',
  refactor: 'refactor',
  docs: 'docs',
  test: 'test',
  tests: 'test',
  chore: 'chore',
  style: 'style',
  perf: 'perf',
  ci: 'ci',
  build: 'build',
  revert: 'revert',
};

interface TrackedRepoRecord {
  repo_path: string;
  last_scanned_at: string;
  last_head: string | null;
  author_email: string | null;
  discovered_from: string | null;
}

export interface ParsedCommit {
  hash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  committedAt: string; // ISO 8601
  coAuthor: string;
  parentHashes: string;  // space-separated parent hashes
  refs: string;          // raw decoration string from %d
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

/** Parse conventional commit type from subject line. */
export function classifyCommitType(subject: string): string {
  const match = subject.match(/^(\w+)(?:\(.+?\))?[!:]/);
  if (match) {
    const prefix = match[1].toLowerCase();
    return COMMIT_TYPE_PREFIXES[prefix] ?? 'other';
  }
  return 'other';
}

/** Detect if commit has an AI co-author trailer (Claude, Codex, etc.). */
export function detectAIAssisted(coAuthor: string): boolean {
  if (!coAuthor) return false;
  const lower = coAuthor.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic')
    || lower.includes('codex') || lower.includes('openai');
}

/** Parse git log output into structured commits. */
export function parseGitLogOutput(stdout: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  const blocks = stdout.split('COMMIT_START\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split('\n');
    // Lines: 0=hash, 1=parents, 2=refs/decorations, 3=subject, 4=authorName, 5=authorEmail, 6=timestamp, 7=coAuthor trailer
    if (lines.length < 7) continue;

    const hash = lines[0].trim();
    if (!hash || hash.length < 7) continue;

    const parentHashes = lines[1]?.trim() ?? '';
    const refs = lines[2]?.trim() ?? '';
    const subject = lines[3] ?? '';
    const authorName = lines[4] ?? '';
    const authorEmail = lines[5] ?? '';
    const committedAt = lines[6] ?? '';
    const coAuthor = lines[7]?.trim() ?? '';

    // Parse shortstat from remaining lines
    let filesChanged: number | null = null;
    let insertions: number | null = null;
    let deletions: number | null = null;

    for (let i = 8; i < lines.length; i++) {
      const statMatch = lines[i].match(
        /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
      );
      if (statMatch) {
        filesChanged = parseInt(statMatch[1], 10);
        insertions = statMatch[2] ? parseInt(statMatch[2], 10) : 0;
        deletions = statMatch[3] ? parseInt(statMatch[3], 10) : 0;
        break;
      }
    }

    commits.push({
      hash,
      subject,
      authorName,
      authorEmail,
      committedAt,
      coAuthor,
      parentHashes,
      refs,
      filesChanged,
      insertions,
      deletions,
    });
  }

  return commits;
}

export class CommitTracker {
  private sessionManager: SessionManager;
  private getWebContents: () => WebContents | null;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private repoRootCache = new Map<string, string | null>();
  private defaultBranchCache = new Map<string, string>();
  private scanning = false;

  constructor(
    sessionManager: SessionManager,
    getWebContents: () => WebContents | null,
  ) {
    this.sessionManager = sessionManager;
    this.getWebContents = getWebContents;
  }

  start(): void {
    // Initial scan on startup
    this.scanAll().catch((err) => {
      logger.warn('commits', 'Initial scan failed', { error: String(err) });
    });

    // Background fallback poll every 5 minutes
    this.backgroundTimer = setInterval(() => {
      this.scanAll().catch((err) => {
        logger.warn('commits', 'Background scan failed', { error: String(err) });
      });
    }, BACKGROUND_POLL_MS);
  }

  stop(): void {
    if (this.backgroundTimer) {
      clearInterval(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }

  /** Trigger a scan for a specific session's repo (e.g., on hook event). */
  async onHookEvent(sessionId: string, event: HookEvent): Promise<void> {
    if (event.hookEventName !== 'PostToolUse' || event.toolName !== 'Bash') return;

    const toolInput = event.toolInput as { command?: string } | null;
    const command = toolInput?.command ?? '';
    const hasGitKeyword = GIT_COMMIT_KEYWORDS.some((kw) => command.includes(kw));
    if (!hasGitKeyword) return;

    // Get the session's cwd and scan its repo
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    const repoRoot = await this.resolveRepoRoot(session.cwd);
    if (!repoRoot) return;

    // Small delay to let git finish writing
    setTimeout(() => {
      this.scanRepo(repoRoot).catch((err) => {
        logger.warn('commits', 'Hook-triggered scan failed', { repoRoot, error: String(err) });
      });
    }, 500);
  }

  /** Scan a specific repo when a new session is created. */
  async onSessionCreated(cwd: string): Promise<void> {
    const repoRoot = await this.resolveRepoRoot(cwd);
    if (!repoRoot) return;

    await this.scanRepo(repoRoot).catch((err) => {
      logger.warn('commits', 'Session-created scan failed', { repoRoot, error: String(err) });
    });
  }

  /** Scan all known repos (called on app focus, tile open, background poll). */
  async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    try {
      const repos = await this.getTrackedRepos();
      let totalNew = 0;

      for (const repoPath of repos) {
        try {
          const newCount = await this.scanRepo(repoPath);
          totalNew += newCount;
        } catch (err) {
          logger.warn('commits', 'Scan failed for repo', { repoPath, error: String(err) });
        }
      }

      if (totalNew > 0) {
        this.broadcastUpdate();
      }
    } finally {
      this.scanning = false;
    }
  }

  /** Scan a single repo and return number of new commits inserted. */
  async scanRepo(repoPath: string): Promise<number> {
    const db = getDb();

    // Get current watermark
    const tracked = db
      .prepare('SELECT * FROM tracked_repos WHERE repo_path = ?')
      .get(repoPath) as TrackedRepoRecord | undefined;

    // Quick check: has HEAD changed?
    const currentHead = await this.gitRevParseHead(repoPath);
    if (currentHead && tracked?.last_head === currentHead) {
      return 0; // Nothing changed on current branch
    }

    // Determine the --after timestamp
    const afterTimestamp = tracked?.last_scanned_at ?? nDaysAgoStart(COMMIT_BACKFILL_DAYS);

    // Detect user's git email for this repo (cache in tracked_repos)
    let authorEmail = tracked?.author_email ?? null;
    if (!authorEmail) {
      authorEmail = await this.gitConfigEmail(repoPath);
    }

    // Run git log
    const commits = await this.gitLog(repoPath, afterTimestamp);

    // Insert new commits
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO commits
        (repo_path, commit_hash, commit_message, commit_type, author_name, author_email,
         is_claude_assisted, committed_at, date, files_changed, insertions, deletions,
         parent_hashes, refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Backfill parent_hashes/refs for existing commits that lack them
    const backfillStmt = db.prepare(`
      UPDATE commits SET parent_hashes = ?, refs = ?
      WHERE repo_path = ? AND commit_hash = ? AND parent_hashes IS NULL
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const commit of commits) {
        const date = commit.committedAt.slice(0, 10); // "2026-03-18"
        const commitType = classifyCommitType(commit.subject);
        const isClaudeAssisted = detectAIAssisted(commit.coAuthor) ? 1 : 0;

        const result = insertStmt.run(
          repoPath,
          commit.hash,
          commit.subject,
          commitType,
          commit.authorName,
          commit.authorEmail,
          isClaudeAssisted,
          commit.committedAt,
          date,
          commit.filesChanged,
          commit.insertions,
          commit.deletions,
          commit.parentHashes || null,
          commit.refs || null,
        );
        if (result.changes > 0) newCount++;

        // Backfill parent_hashes for pre-existing commits
        if (result.changes === 0 && commit.parentHashes) {
          backfillStmt.run(
            commit.parentHashes,
            commit.refs || null,
            repoPath,
            commit.hash,
          );
        }
      }
    });
    insertAll();

    // Update watermark
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tracked_repos (repo_path, last_scanned_at, last_head, author_email, discovered_from)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo_path) DO UPDATE SET
        last_scanned_at = excluded.last_scanned_at,
        last_head = excluded.last_head,
        author_email = COALESCE(excluded.author_email, tracked_repos.author_email)
    `).run(repoPath, now, currentHead, authorEmail, repoPath);

    if (newCount > 0) {
      logger.info('commits', `Found ${newCount} new commits`, { repoPath });
      this.broadcastUpdate();
    }

    return newCount;
  }

  // --- Query methods ---

  getDailyStats(date?: string): DailyCommitStats {
    const db = getDb();
    const targetDate = date ?? todayDate();

    // Overall totals
    const totals = db.prepare(`
      SELECT COUNT(*) as total,
             COALESCE(SUM(insertions), 0) as totalInsertions,
             COALESCE(SUM(deletions), 0) as totalDeletions,
             SUM(CASE WHEN is_claude_assisted = 1 THEN 1 ELSE 0 END) as claudeAssisted
      FROM commits WHERE date = ?
    `).get(targetDate) as {
      total: number;
      totalInsertions: number;
      totalDeletions: number;
      claudeAssisted: number;
    };

    // Per-repo breakdown
    const byRepo = db.prepare(`
      SELECT repo_path,
             COUNT(*) as count,
             COALESCE(SUM(insertions), 0) as insertions,
             COALESCE(SUM(deletions), 0) as deletions
      FROM commits WHERE date = ?
      GROUP BY repo_path
      ORDER BY count DESC
    `).all(targetDate) as { repo_path: string; count: number; insertions: number; deletions: number }[];

    // By commit type
    const byType = db.prepare(`
      SELECT commit_type, COUNT(*) as count
      FROM commits WHERE date = ?
      GROUP BY commit_type
      ORDER BY count DESC
    `).all(targetDate) as { commit_type: string; count: number }[];

    return {
      date: targetDate,
      total: totals.total,
      totalInsertions: totals.totalInsertions,
      totalDeletions: totals.totalDeletions,
      claudeAssisted: totals.claudeAssisted,
      soloCount: totals.total - totals.claudeAssisted,
      byRepo: byRepo.map((r) => ({
        repoPath: r.repo_path,
        count: r.count,
        insertions: r.insertions,
        deletions: r.deletions,
      })),
      byType: byType.map((t) => ({
        type: t.commit_type ?? 'other',
        count: t.count,
      })),
    };
  }

  getHeatmap(days = 7): CommitHeatmapEntry[] {
    const db = getDb();

    // Compute start date in local time to match how commit dates are stored
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startDateStr = localDateStr(startDate);

    const rows = db.prepare(`
      SELECT date, COUNT(*) as count,
             COALESCE(SUM(insertions), 0) as insertions
      FROM commits
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(startDateStr) as { date: string; count: number; insertions: number }[];

    // Fill in missing days with zero counts
    const result: CommitHeatmapEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = localDateStr(d);
      const existing = rows.find((r) => r.date === dateStr);
      result.push({
        date: dateStr,
        count: existing?.count ?? 0,
        insertions: existing?.insertions ?? 0,
      });
    }

    return result;
  }

  getStreaks(): CommitStreakInfo {
    const db = getDb();

    // Get all distinct dates with commits, ordered
    const dates = db.prepare(`
      SELECT DISTINCT date FROM commits ORDER BY date ASC
    `).all() as { date: string }[];

    if (dates.length === 0) {
      return { current: 0, longest: 0 };
    }

    const today = todayDate();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = localDateStr(yesterday);

    let longest = 1;
    let current = 0;
    let streak = 1;

    // Calculate longest streak
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1].date);
      const curr = new Date(dates[i].date);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (86400 * 1000));

      if (diffDays === 1) {
        streak++;
        longest = Math.max(longest, streak);
      } else {
        streak = 1;
      }
    }

    // Calculate current streak (must include today or yesterday)
    const lastDate = dates[dates.length - 1].date;
    if (lastDate === today || lastDate === yesterdayStr) {
      current = 1;
      for (let i = dates.length - 2; i >= 0; i--) {
        const curr = new Date(dates[i + 1].date);
        const prev = new Date(dates[i].date);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (86400 * 1000));
        if (diffDays === 1) {
          current++;
        } else {
          break;
        }
      }
    }

    return { current, longest };
  }

  getCadence(date?: string): CommitCadenceInfo {
    const db = getDb();
    const targetDate = date ?? todayDate();

    const commits = db.prepare(`
      SELECT committed_at FROM commits
      WHERE date = ?
      ORDER BY committed_at ASC
    `).all(targetDate) as { committed_at: string }[];

    if (commits.length < 2) {
      return { avgMinutes: null, peakHour: null, commitsByHour: {} };
    }

    // Average interval between commits
    let totalIntervalMs = 0;
    for (let i = 1; i < commits.length; i++) {
      const prev = new Date(commits[i - 1].committed_at).getTime();
      const curr = new Date(commits[i].committed_at).getTime();
      totalIntervalMs += curr - prev;
    }
    const avgMinutes = Math.round(totalIntervalMs / (commits.length - 1) / 60000);

    // Commits by hour
    const commitsByHour: Record<string, number> = {};
    for (const c of commits) {
      const hour = new Date(c.committed_at).getHours().toString().padStart(2, '0');
      commitsByHour[hour] = (commitsByHour[hour] ?? 0) + 1;
    }

    // Peak hour
    let peakHour: string | null = null;
    let peakCount = 0;
    for (const [hour, count] of Object.entries(commitsByHour)) {
      if (count > peakCount) {
        peakCount = count;
        peakHour = hour;
      }
    }

    return { avgMinutes, peakHour, commitsByHour };
  }

  getWeeklyTrend(): CommitWeeklyTrend {
    const db = getDb();

    const thisWeek = db.prepare(`
      SELECT COUNT(*) as count FROM commits
      WHERE date >= date('now', 'weekday 0', '-6 days')
    `).get() as { count: number };

    const lastWeek = db.prepare(`
      SELECT COUNT(*) as count FROM commits
      WHERE date >= date('now', 'weekday 0', '-13 days')
        AND date < date('now', 'weekday 0', '-6 days')
    `).get() as { count: number };

    const pctChange = lastWeek.count > 0
      ? Math.round(((thisWeek.count - lastWeek.count) / lastWeek.count) * 100)
      : null;

    return {
      thisWeek: thisWeek.count,
      lastWeek: lastWeek.count,
      pctChange,
    };
  }

  /** Reset watermarks and re-scan all repos from scratch (up to COMMIT_BACKFILL_DAYS back). */
  async forceRescan(): Promise<void> {
    const db = getDb();
    db.prepare(`DELETE FROM tracked_repos`).run();
    await this.scanAll();
  }

  // --- Private helpers ---

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

  /** Get distinct tracked repo roots from all session cwds. */
  private async getTrackedRepos(): Promise<string[]> {
    const db = getDb();
    const rows = db.prepare(
      "SELECT DISTINCT cwd FROM sessions WHERE status != 'ended'",
    ).all() as { cwd: string }[];

    const repoRoots = new Set<string>();
    for (const row of rows) {
      const root = await this.resolveRepoRoot(row.cwd);
      if (root) repoRoots.add(root);
    }

    // Also include repos from tracked_repos (in case all sessions have ended)
    const tracked = db.prepare('SELECT repo_path FROM tracked_repos').all() as { repo_path: string }[];
    for (const t of tracked) {
      repoRoots.add(t.repo_path);
    }

    return [...repoRoots];
  }

  /** Quick check: get HEAD commit hash. */
  private async gitRevParseHead(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS },
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Get user's git email for a repo. */
  private async gitConfigEmail(repoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['config', 'user.email'],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS },
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Detect the default branch for a repo (main/master). Cached per repo. */
  private async getDefaultBranch(repoPath: string): Promise<string> {
    const cached = this.defaultBranchCache.get(repoPath);
    if (cached) return cached;

    // Try symbolic-ref to origin HEAD
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS },
      );
      const branch = stdout.trim().replace('refs/remotes/origin/', '');
      if (branch) {
        this.defaultBranchCache.set(repoPath, branch);
        return branch;
      }
    } catch { /* fall through */ }

    // Fallback: try main, then master
    for (const candidate of ['main', 'master']) {
      try {
        await execFileAsync(
          'git',
          ['rev-parse', '--verify', candidate],
          { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS },
        );
        this.defaultBranchCache.set(repoPath, candidate);
        return candidate;
      } catch { /* try next */ }
    }

    // Last resort: current HEAD
    this.defaultBranchCache.set(repoPath, 'HEAD');
    return 'HEAD';
  }

  /** Run git log and parse output. */
  private async gitLog(repoPath: string, after: string): Promise<ParsedCommit[]> {
    try {
      const scanAll = getPreferenceBool('commitScanAllBranches', false);

      const args = [
        'log',
        `--format=COMMIT_START%n%H%n%P%n%d%n%s%n%an%n%ae%n%aI%n%(trailers:key=Co-authored-by,valueonly)`,
        '--shortstat',
        `--after=${after}`,
      ];

      if (scanAll) {
        args.push('--all');
      } else {
        args.push(await this.getDefaultBranch(repoPath));
      }

      const { stdout } = await execFileAsync(
        'git',
        args,
        { cwd: repoPath, timeout: GIT_COMMAND_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      );
      return parseGitLogOutput(stdout);
    } catch {
      return [];
    }
  }

  private broadcastUpdate(): void {
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('commits:updated');
    }
  }
}

/** Format a Date as YYYY-MM-DD in the local timezone. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayDate(): string {
  return localDateStr(new Date());
}

function nDaysAgoStart(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateStr(d) + 'T00:00:00';
}

export function registerCommitIpc(commitTracker: CommitTracker): void {
  typedHandle('commits:get-daily-stats', (date) => {
    return commitTracker.getDailyStats(date);
  });

  typedHandle('commits:get-heatmap', (days) => {
    return commitTracker.getHeatmap(days);
  });

  typedHandle('commits:get-streaks', () => {
    return commitTracker.getStreaks();
  });

  typedHandle('commits:get-cadence', (date) => {
    return commitTracker.getCadence(date);
  });

  typedHandle('commits:get-weekly-trend', () => {
    return commitTracker.getWeeklyTrend();
  });

  typedHandle('commits:refresh', async () => {
    await commitTracker.scanAll();
  });

  typedHandle('commits:force-rescan', async () => {
    await commitTracker.forceRescan();
  });
}

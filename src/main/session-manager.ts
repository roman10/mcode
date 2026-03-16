import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { WebContents } from 'electron';
import type { PtyManager } from './pty-manager';
import { getDb } from './db';
import { logger } from './logger';
import { DEFAULT_COLS, DEFAULT_ROWS, type PermissionMode } from '../shared/constants';
import type {
  SessionInfo,
  SessionStatus,
  SessionCreateInput,
} from '../shared/types';

interface SessionRecord {
  session_id: string;
  label: string;
  cwd: string;
  permission_mode: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
}

function toSessionInfo(row: SessionRecord): SessionInfo {
  return {
    sessionId: row.session_id,
    label: row.label,
    cwd: row.cwd,
    status: row.status as SessionStatus,
    permissionMode: (row.permission_mode as PermissionMode) ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class SessionManager {
  private ptyManager: PtyManager;
  private getWebContents: () => WebContents | null;

  constructor(
    ptyManager: PtyManager,
    getWebContents: () => WebContents | null,
  ) {
    this.ptyManager = ptyManager;
    this.getWebContents = getWebContents;
  }

  create(input: SessionCreateInput): SessionInfo {
    const sessionId = randomUUID();
    const cwd = input.cwd;
    const label = input.label || basename(cwd);
    const startedAt = new Date().toISOString();

    const command = input.command ?? 'claude';

    // Build args for CLI
    const args: string[] = [];
    if (input.permissionMode) {
      args.push('--permission-mode', input.permissionMode);
    }
    if (input.initialPrompt) {
      args.push(input.initialPrompt);
    }

    // Insert DB row FIRST so that onFirstData/onExit callbacks can UPDATE it.
    // If spawn fails, we delete the row.
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (session_id, label, cwd, permission_mode, status, started_at)
       VALUES (?, ?, ?, ?, 'starting', ?)`,
    ).run(sessionId, label, cwd, input.permissionMode ?? null, startedAt);

    try {
      this.ptyManager.spawn({
        id: sessionId,
        command,
        cwd,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        args: args.length > 0 ? args : undefined,
        env: { MCODE_SESSION_ID: sessionId },
        onFirstData: () => {
          this.updateStatus(sessionId, 'active');
        },
        onExit: () => {
          this.updateStatus(sessionId, 'ended');
        },
      });
    } catch (err) {
      // Spawn failed — remove the row we just inserted
      db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
      throw err;
    }

    logger.info('session', 'Created session', { sessionId, cwd, label });

    return {
      sessionId,
      label,
      cwd,
      status: 'starting',
      permissionMode: input.permissionMode,
      startedAt,
      endedAt: null,
    };
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const db = getDb();

    // Idempotency guard — skip if already in target state
    const current = db
      .prepare('SELECT status FROM sessions WHERE session_id = ?')
      .get(sessionId) as { status: string } | undefined;
    if (!current || current.status === status) return;

    if (status === 'ended') {
      db.prepare(
        `UPDATE sessions SET status = ?, ended_at = ? WHERE session_id = ?`,
      ).run(status, new Date().toISOString(), sessionId);
    } else {
      db.prepare(
        `UPDATE sessions SET status = ? WHERE session_id = ?`,
      ).run(status, sessionId);
    }

    logger.info('session', 'Status changed', { sessionId, status });

    // Notify renderer
    const wc = this.getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('session:status-change', sessionId, status);
    }
  }

  async kill(sessionId: string): Promise<void> {
    // PTY's onExit callback handles the status transition to 'ended',
    // so we don't call updateStatus here (avoids double transition).
    await this.ptyManager.kill(sessionId);
    logger.info('session', 'Killed session', { sessionId });
  }

  get(sessionId: string): SessionInfo | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRecord | undefined;
    return row ? toSessionInfo(row) : null;
  }

  list(): SessionInfo[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
      .all() as SessionRecord[];
    return rows.map(toSessionInfo);
  }

  setLabel(sessionId: string, label: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET label = ? WHERE session_id = ?').run(
      label,
      sessionId,
    );
  }

  /** Mark all non-ended sessions as ended. Called on app quit. */
  endAllActive(): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE sessions SET status = 'ended', ended_at = ? WHERE status != 'ended'`,
    ).run(now);
    logger.info('session', 'Marked all active sessions as ended');
  }

  // --- Layout persistence ---

  saveLayout(mosaicTree: unknown, sidebarWidth?: number): void {
    const db = getDb();
    if (mosaicTree === null || mosaicTree === undefined) {
      db.prepare('DELETE FROM layout_state WHERE id = 1').run();
      return;
    }
    const json = JSON.stringify(mosaicTree);
    const width = sidebarWidth ?? 280;
    db.prepare(
      `INSERT INTO layout_state (id, mosaic_tree, sidebar_width, updated_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET mosaic_tree = ?, sidebar_width = ?, updated_at = datetime('now')`,
    ).run(json, width, json, width);
  }

  loadLayout(): { mosaicTree: unknown; sidebarWidth: number } | null {
    const db = getDb();
    const row = db
      .prepare('SELECT mosaic_tree, sidebar_width FROM layout_state WHERE id = 1')
      .get() as { mosaic_tree: string; sidebar_width: number } | undefined;
    if (!row) return null;
    try {
      return {
        mosaicTree: JSON.parse(row.mosaic_tree),
        sidebarWidth: row.sidebar_width,
      };
    } catch {
      return null;
    }
  }

}

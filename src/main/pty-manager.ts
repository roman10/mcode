import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { WebContents } from 'electron';
import type { PtySpawnOptions } from '../shared/types';
import { PTY_KILL_TIMEOUT_MS } from '../shared/constants';

interface PtyHandle {
  id: string;
  process: pty.IPty;
  cols: number;
  rows: number;
  /** Resolves when the process exits. Set once in spawn(). */
  exitPromise: Promise<void>;
}

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return (
    process.env.SHELL ||
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  );
}

export class PtyManager {
  private ptys = new Map<string, PtyHandle>();
  private getWebContents: () => WebContents | null;

  constructor(getWebContents: () => WebContents | null) {
    this.getWebContents = getWebContents;
  }

  spawn(options: PtySpawnOptions): string {
    const id = randomUUID();
    const cwd = options.cwd || os.homedir();
    const shell = resolveShell();

    const proc = pty.spawn(shell, options.args || [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
    });

    // Single onExit listener — handles renderer notification, map cleanup,
    // and provides a promise for kill() to await.
    let resolveExit: () => void;
    const exitPromise = new Promise<void>((r) => {
      resolveExit = r;
    });

    proc.onData((data) => {
      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.send('pty:data', id, data);
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.send('pty:exit', id, { code: exitCode, signal });
      }
      this.ptys.delete(id);
      resolveExit();
    });

    const handle: PtyHandle = {
      id,
      process: proc,
      cols: options.cols,
      rows: options.rows,
      exitPromise,
    };

    this.ptys.set(id, handle);
    return id;
  }

  write(id: string, data: string): void {
    const handle = this.ptys.get(id);
    if (handle) {
      handle.process.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const handle = this.ptys.get(id);
    if (handle) {
      handle.process.resize(cols, rows);
      handle.cols = cols;
      handle.rows = rows;
    }
  }

  kill(id: string): Promise<void> {
    const handle = this.ptys.get(id);
    if (!handle) return Promise.resolve();

    const proc = handle.process;

    // Send SIGTERM
    proc.kill();

    // Race: either the process exits gracefully, or we SIGKILL after timeout
    const forceKill = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.ptys.has(id)) {
          try {
            process.kill(proc.pid, 'SIGKILL');
          } catch {
            // Process may have already exited
          }
        }
        resolve();
      }, PTY_KILL_TIMEOUT_MS);
    });

    return Promise.race([handle.exitPromise, forceKill]);
  }

  async killAll(): Promise<void> {
    const ids = Array.from(this.ptys.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
  }

  getInfo(
    id: string,
  ): { id: string; pid: number; cols: number; rows: number } | null {
    const handle = this.ptys.get(id);
    if (!handle) return null;
    return {
      id: handle.id,
      pid: handle.process.pid,
      cols: handle.cols,
      rows: handle.rows,
    };
  }

  list(): string[] {
    return Array.from(this.ptys.keys());
  }
}

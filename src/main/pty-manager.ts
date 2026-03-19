import * as pty from 'node-pty';
import type { WebContents } from 'electron';
import type { PtySpawnOptions } from '../shared/types';
import { PTY_KILL_TIMEOUT_MS, RING_BUFFER_MAX_BYTES } from '../shared/constants';
import { logger } from './logger';

interface PtyHandle {
  id: string;
  process: pty.IPty;
  cols: number;
  rows: number;
  ringBuffer: string;
  lastDataAt: number;
  exitPromise: Promise<void>;
}

export class PtyManager {
  private ptys = new Map<string, PtyHandle>();
  private getWebContents: () => WebContents | null;

  constructor(getWebContents: () => WebContents | null) {
    this.getWebContents = getWebContents;
  }

  spawn(options: PtySpawnOptions): string {
    const { id, command, cwd, cols, rows, args, env, onFirstData, onExit: onExitCb } = options;

    const proc = pty.spawn(command, args || [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    let resolveExit: () => void;
    const exitPromise = new Promise<void>((r) => {
      resolveExit = r;
    });

    let firstDataFired = false;

    proc.onData((data) => {
      // Fire onFirstData callback once
      if (!firstDataFired && onFirstData) {
        firstDataFired = true;
        onFirstData();
      }

      // Append to ring buffer
      const handle = this.ptys.get(id);
      if (handle) {
        handle.lastDataAt = Date.now();
        handle.ringBuffer += data;
        if (handle.ringBuffer.length > RING_BUFFER_MAX_BYTES) {
          handle.ringBuffer = handle.ringBuffer.slice(-RING_BUFFER_MAX_BYTES);
        }
      }

      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.send('pty:data', id, data);
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      logger.info('pty', 'Process exited', { id, exitCode, signal });
      const wc = this.getWebContents();
      if (wc && !wc.isDestroyed()) {
        wc.send('pty:exit', id, { code: exitCode, signal });
      }
      this.ptys.delete(id);
      if (onExitCb) onExitCb(exitCode, signal);
      resolveExit();
    });

    const handle: PtyHandle = {
      id,
      process: proc,
      cols,
      rows,
      ringBuffer: '',
      lastDataAt: 0,
      exitPromise,
    };

    this.ptys.set(id, handle);
    logger.info('pty', 'Spawned process', { id, command, cwd, pid: proc.pid });
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
    proc.kill();

    const forceKill = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.ptys.has(id) && proc.pid > 0) {
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

  getReplayData(id: string): string {
    const handle = this.ptys.get(id);
    return handle?.ringBuffer ?? '';
  }

  getLastDataAt(id: string): number {
    return this.ptys.get(id)?.lastDataAt ?? 0;
  }

  list(): string[] {
    return Array.from(this.ptys.keys());
  }
}

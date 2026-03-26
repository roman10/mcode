import * as pty from 'node-pty';
import type { PtySpawnOptions } from '../shared/types';
import type { IPtyManager } from '../shared/pty-manager-interface';
import { PTY_KILL_TIMEOUT_MS, RING_BUFFER_MAX_BYTES } from '../shared/constants';

interface Logger {
  info(module: string, message: string, data?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  info: (mod, msg, data) => console.log(`[${mod}]`, msg, data ?? ''),
};

interface PtyHandle {
  id: string;
  process: pty.IPty;
  cols: number;
  rows: number;
  ringBuffer: string;
  lastDataAt: number;
  exitPromise: Promise<void>;
}

// Strip Electron-internal env vars that must not leak into user shell sessions.
// ELECTRON_RUN_AS_NODE=1 causes the Electron binary to start in plain Node.js
// mode, which breaks `require('electron')` in any child process (e.g. npm run dev).
const ELECTRON_INTERNAL_VARS = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_EXEC_PATH', 'ELECTRON_MAJOR_VER'];

function buildPtyEnv(overrides?: Record<string, string>): Record<string, string> {
  const base = { ...process.env };
  for (const key of ELECTRON_INTERNAL_VARS) {
    delete base[key];
  }
  return { ...base, ...overrides } as Record<string, string>;
}

export class PtyManager implements IPtyManager {
  private ptys = new Map<string, PtyHandle>();
  private onData: (id: string, data: string) => void;
  private onPtyExit: (id: string, exitCode: number, signal?: number) => void;
  private logger: Logger;

  constructor(
    onData: (id: string, data: string) => void,
    onPtyExit: (id: string, exitCode: number, signal?: number) => void,
    logger?: Logger,
  ) {
    this.onData = onData;
    this.onPtyExit = onPtyExit;
    this.logger = logger ?? defaultLogger;
  }

  spawn(options: PtySpawnOptions): string {
    const { id, command, cwd, cols, rows, args, env, onFirstData, onExit: onExitCb } = options;

    const proc = pty.spawn(command, args || [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: buildPtyEnv(env),
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

      this.onData(id, data);
    });

    proc.onExit(({ exitCode, signal }) => {
      this.logger.info('pty', 'Process exited', { id, exitCode, signal });
      this.ptys.delete(id);
      if (onExitCb) onExitCb(exitCode, signal);
      this.onPtyExit(id, exitCode, signal);
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
    this.logger.info('pty', 'Spawned process', { id, command, cwd, pid: proc.pid });
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

  listInfo(): Array<{ id: string; pid: number }> {
    return Array.from(this.ptys.entries()).map(([id, handle]) => ({
      id,
      pid: handle.process.pid,
    }));
  }
}

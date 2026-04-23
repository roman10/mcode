import * as net from 'node:net';
import * as readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { IPtyManager, PtyInfo } from '../../shared/pty-manager-interface';
import type { PtySpawnOptions } from '../../shared/types';
import { RING_BUFFER_MAX_BYTES, DEFAULT_COLS, DEFAULT_ROWS } from '../../shared/constants';
import { logger } from '../logger';
import { typedHandle, typedOn } from '../ipc-helpers';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class BrokerClient extends EventEmitter implements IPtyManager {
  private socket: net.Socket | null = null;
  private rl: readline.Interface | null = null;
  private socketPath = '';
  private pending = new Map<string, PendingRequest>();
  private firstDataCallbacks = new Map<string, () => void>();
  private exitCallbacks = new Map<string, (code: number, signal?: number) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shuttingDown = false;

  // Local ring buffers — kept in sync by streaming pty.data events
  private ringBuffers = new Map<string, string>();
  private lastDataAtMap = new Map<string, number>();
  // Cached PTY info (cols/rows from spawn, pid unknown so 0)
  private ptyInfoMap = new Map<string, PtyInfo>();

  // Outbound 'pty.data' event coalescer: merges chunks arriving within the
  // same event-loop iteration into a single emit, so the renderer sees one
  // IPC/term.write per tick instead of one per OS pty read.
  private pendingEmit = new Map<string, string>();
  private pendingEmitTimer = new Map<string, NodeJS.Immediate>();
  private static readonly MAX_BATCH_BYTES = 64 * 1024;

  async connect(socketPath: string): Promise<void> {
    this.socketPath = socketPath;
    return this._connect();
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      socket.once('connect', () => {
        this.socket = socket;
        this.reconnectAttempts = 0;

        this.rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
        this.rl.on('line', (line) => this._handleLine(line));

        const onDisconnect = (): void => {
          if (this.socket !== socket) return; // already replaced by a new connection
          this.socket = null;
          this._rejectAllPending('Broker disconnected');
          if (!this.shuttingDown) this._scheduleReconnect();
        };
        socket.on('error', onDisconnect);
        socket.on('close', onDisconnect);

        resolve();
      });

      socket.once('error', (err) => {
        reject(err);
      });
    });
  }

  private _scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) return;

    const delay = Math.min(200 * Math.pow(2, this.reconnectAttempts), 5000);
    this.reconnectAttempts++;

    if (this.reconnectAttempts > 5) {
      logger.warn('broker-client', 'Broker unavailable after retries — will respawn');
      this.emit('broker-unavailable');
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this._connect();
        logger.info('broker-client', 'Reconnected to broker');
        this.emit('reconnected');
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  disconnect(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const t of this.pendingEmitTimer.values()) clearImmediate(t);
    this.pendingEmitTimer.clear();
    this.pendingEmit.clear();
    this._rejectAllPending('Broker client disconnecting');
    this.rl?.close();
    this.socket?.destroy();
    this.socket = null;
  }

  private _enqueueDataEmit(id: string, data: string): void {
    const next = (this.pendingEmit.get(id) ?? '') + data;
    this.pendingEmit.set(id, next);
    if (next.length >= BrokerClient.MAX_BATCH_BYTES) {
      this._flushDataEmit(id);
      return;
    }
    if (!this.pendingEmitTimer.has(id)) {
      this.pendingEmitTimer.set(id, setImmediate(() => this._flushDataEmit(id)));
    }
  }

  private _flushDataEmit(id: string): void {
    const timer = this.pendingEmitTimer.get(id);
    if (timer) {
      clearImmediate(timer);
      this.pendingEmitTimer.delete(id);
    }
    const buf = this.pendingEmit.get(id);
    this.pendingEmit.delete(id);
    if (buf) this.emit('pty.data', id, buf);
  }

  private _rejectAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async shutdownBroker(): Promise<void> {
    // Prevent reconnect attempts while shutting down the broker
    this.shuttingDown = true;
    await this._request('broker.shutdown', {});
    // Wait for socket to close (broker exits after responding)
    await new Promise<void>((resolve) => {
      if (!this.socket || this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.once('close', resolve);
      setTimeout(resolve, 3000); // safety timeout
    });
    this.disconnect();
  }

  async listSessions(): Promise<Array<{ id: string; pid: number }>> {
    return this._request<Array<{ id: string; pid: number }>>('pty.list', {});
  }

  /**
   * Fetch replay data from the broker and populate the local ring buffer.
   * Used on reconnect to restore the cached state for live sessions.
   */
  async populateFromBroker(id: string, ptyInfo?: { pid: number }): Promise<void> {
    const data = await this._request<string>('pty.replay', { id });
    if (data) {
      this.ringBuffers.set(id, data.slice(-RING_BUFFER_MAX_BYTES));
      this.lastDataAtMap.set(id, Date.now());
    }
    // Restore PTY info so getInfo() works for recovered sessions.
    // Use provided pid from broker; default cols/rows are updated when the
    // renderer mounts the terminal component and sends a resize event.
    if (!this.ptyInfoMap.has(id)) {
      this.ptyInfoMap.set(id, {
        id,
        pid: ptyInfo?.pid ?? 0,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
    }
  }

  /**
   * Fetch replay data directly from broker (async) — used by IPC handler
   * to serve the renderer's replay request with the full broker ring buffer.
   */
  fetchReplayFromBroker(id: string): Promise<string> {
    return this._request<string>('pty.replay', { id });
  }

  private _request<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Broker not connected'));
        return;
      }
      const id = randomUUID();
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const msg = JSON.stringify({ id, method, params }) + '\n';
      this.socket.write(msg);
    });
  }

  private _send(method: string, params: unknown): void {
    if (!this.socket || this.socket.destroyed) {
      logger.warn('broker-client', `Cannot send ${method}: broker not connected`);
      return;
    }
    const msg = JSON.stringify({ method, params }) + '\n';
    this.socket.write(msg);
  }

  private _handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if ('event' in msg) {
      this._handleEvent(msg.event as string, (msg.params ?? {}) as Record<string, unknown>);
    } else if ('id' in msg) {
      const pending = this.pending.get(msg.id as string);
      if (pending) {
        this.pending.delete(msg.id as string);
        if ('error' in msg) {
          pending.reject(new Error(((msg.error as { message: string }) ?? {}).message ?? 'Unknown error'));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private _handleEvent(event: string, params: Record<string, unknown>): void {
    switch (event) {
      case 'pty.data': {
        const id = params.id as string;
        const data = params.data as string;
        // Update local ring buffer and timestamp per-chunk so synchronous
        // consumers (getReplayData, getLastDataAt, quiescence polling) stay
        // current; only the outward emit is coalesced below.
        const existing = this.ringBuffers.get(id) ?? '';
        const updated = existing + data;
        this.ringBuffers.set(id, updated.length > RING_BUFFER_MAX_BYTES ? updated.slice(-RING_BUFFER_MAX_BYTES) : updated);
        this.lastDataAtMap.set(id, Date.now());
        this._enqueueDataEmit(id, data);
        break;
      }

      case 'pty.exit': {
        const id = params.id as string;
        // Drain any buffered bytes before the exit signal so the renderer
        // never sees the tail of output arrive after exit.
        this._flushDataEmit(id);
        this.emit('pty.exit', id, params.code, params.signal);
        const cb = this.exitCallbacks.get(id);
        if (cb) {
          cb(params.code as number, params.signal as number | undefined);
          this.exitCallbacks.delete(id);
        }
        // Clear local buffers when session ends
        this.ringBuffers.delete(id);
        this.lastDataAtMap.delete(id);
        this.ptyInfoMap.delete(id);
        break;
      }

      case 'pty.first-data': {
        const cb = this.firstDataCallbacks.get(params.id as string);
        if (cb) {
          cb();
          this.firstDataCallbacks.delete(params.id as string);
        }
        break;
      }

      case 'broker.hello':
        logger.info('broker-client', 'Connected to broker', params);
        break;
    }
  }

  // --- IPtyManager implementation ---

  spawn(options: PtySpawnOptions): string {
    const { id, onFirstData, onExit, ...rest } = options;
    // Register callbacks BEFORE sending (avoid race with fast first-data events)
    if (onFirstData) this.firstDataCallbacks.set(id, onFirstData);
    if (onExit) this.exitCallbacks.set(id, onExit);
    // Cache PTY info (pid unknown at spawn time — use 0)
    this.ptyInfoMap.set(id, { id, pid: 0, cols: options.cols, rows: options.rows });
    this._send('pty.spawn', { id, ...rest });
    return id;
  }

  write(id: string, data: string): void {
    this._send('pty.write', { id, data });
  }

  resize(id: string, cols: number, rows: number): void {
    // Update cached info
    const info = this.ptyInfoMap.get(id);
    if (info) this.ptyInfoMap.set(id, { ...info, cols, rows });
    this._send('pty.resize', { id, cols, rows });
  }

  kill(id: string): Promise<void> {
    return this._request('pty.kill', { id });
  }

  killAll(): Promise<void> {
    return this._request('pty.kill-all', {});
  }

  /** Synchronous — returns locally cached ring buffer content. */
  getReplayData(id: string): string {
    return this.ringBuffers.get(id) ?? '';
  }

  /** Synchronous — returns timestamp of last received pty.data event. */
  getLastDataAt(id: string): number {
    return this.lastDataAtMap.get(id) ?? 0;
  }

  /** Returns cached PTY info, or null if session not found. */
  getInfo(id: string): PtyInfo | null {
    return this.ptyInfoMap.get(id) ?? null;
  }
}

export function registerPtyIpc(brokerClient: BrokerClient): void {
  typedOn('pty:write', (id, data) => {
    brokerClient.write(id, data);
  });

  typedOn('pty:resize', (id, cols, rows) => {
    brokerClient.resize(id, cols, rows);
  });

  typedHandle('pty:kill', (id) => {
    return brokerClient.kill(id);
  });

  typedHandle('pty:replay', (sessionId) => {
    return brokerClient.fetchReplayFromBroker(sessionId);
  });
}

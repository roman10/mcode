import type { BrokerDiagnostics, PtySpawnOptions } from './types';

export interface PtyInfo {
  id: string;
  pid: number;
  cols: number;
  rows: number;
}

export type PtyDataListener = (id: string, data: string) => void;
export type PtyExitListener = (id: string, code: number, signal?: number) => void;

export interface IPtyManager {
  spawn(options: PtySpawnOptions): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
  /**
   * Returns cached ring buffer content synchronously. Decodes the entire
   * ~512 KB window — use only when the full transcript is required
   * (renderer replay, fork/resume, devtools dump). For recent-content scans
   * (permission-prompt detection, user-choice menus), prefer `getReplayDataTail`.
   */
  getReplayData(id: string): string;
  /**
   * Tail-only variant of `getReplayData`. Decodes only the last `bytes` bytes
   * of the ring buffer. Use on hot paths that scan recent output.
   */
  getReplayDataTail(id: string, bytes: number): string;
  /** Returns timestamp (ms) of last PTY data received, 0 if never. */
  getLastDataAt(id: string): number;
  /** Returns basic info about a PTY session, or null if not found. */
  getInfo(id: string): PtyInfo | null;
  /** Memory accounting for diagnostics. */
  getDiagnostics(): BrokerDiagnostics;
}

/**
 * Main-process PTY surface that also exposes pty.data / pty.exit events.
 * Implemented by BrokerClient (which is an EventEmitter); SessionManager
 * uses these events to drive event-driven session-state detection.
 * The broker-side PtyManager does not implement this — it forwards
 * data/exit via its constructor callbacks instead.
 */
export interface IObservablePtyManager extends IPtyManager {
  on(event: 'pty.data', listener: PtyDataListener): this;
  on(event: 'pty.exit', listener: PtyExitListener): this;
  off(event: 'pty.data', listener: PtyDataListener): this;
  off(event: 'pty.exit', listener: PtyExitListener): this;
}

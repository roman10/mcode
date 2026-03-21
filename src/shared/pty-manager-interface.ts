import type { PtySpawnOptions } from './types';

export interface PtyInfo {
  id: string;
  pid: number;
  cols: number;
  rows: number;
}

export interface IPtyManager {
  spawn(options: PtySpawnOptions): string;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): Promise<void>;
  killAll(): Promise<void>;
  /** Returns cached ring buffer content synchronously. */
  getReplayData(id: string): string;
  /** Returns timestamp (ms) of last PTY data received, 0 if never. */
  getLastDataAt(id: string): number;
  /** Returns basic info about a PTY session, or null if not found. */
  getInfo(id: string): PtyInfo | null;
}

// --- PTY ---

export interface PtySpawnOptions {
  id: string;
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  args?: string[];
  env?: Record<string, string>;
  onFirstData?: () => void;
  onExit?: (exitCode: number, signal?: number) => void;
}

export interface PtyExitPayload {
  code: number;
  signal?: number;
}

/**
 * Delta replay response from `pty:replay-since`. `dataStartOffset > offset`
 * (the caller's argument) signals that the broker ring buffer wrapped past
 * the requested offset — the caller should clear its terminal before writing
 * `data`. `dataStartOffset === offset` means `data` is exactly the bytes
 * appended since `offset`. Empty `data` means the caller is up to date.
 */
export interface PtyReplayDelta {
  data: string;
  dataStartOffset: number;
  currentOffset: number;
}

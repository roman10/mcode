export interface PtySpawnOptions {
  cwd?: string;
  cols: number;
  rows: number;
  args?: string[];
  env?: Record<string, string>;
}

export interface PtyExitPayload {
  code: number;
  signal?: number;
}

export interface MCodeAPI {
  pty: {
    spawn(options: PtySpawnOptions): Promise<string>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, payload: PtyExitPayload) => void): () => void;
  };
}

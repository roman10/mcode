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

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  timestamp: number;
  args: string[];
}

export interface HmrEvent {
  type: string;
  timestamp: number;
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
  devtools: {
    onQuery(
      cb: (
        requestId: string,
        type: string,
        params: Record<string, unknown>,
      ) => void,
    ): void;
    sendResponse(requestId: string, data: unknown): void;
  };
}

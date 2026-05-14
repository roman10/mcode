// --- Memory diagnostics ---

export interface MemorySnapshot {
  capturedAt: number;
  main: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  v8: {
    totalHeapSize: number;
    usedHeapSize: number;
    heapSizeLimit: number;
    mallocedMemory: number;
    externalMemory: number;
    heapSpaces: Array<{ name: string; size: number; used: number }>;
  };
  processes: Array<{
    pid: number;
    type: string;
    name?: string;
    serviceName?: string;
    cpuPercent: number;
    /** Working-set in KB (Electron reports kilobytes). */
    memoryWorkingSetKb: number;
    memoryPeakWorkingSetKb: number;
  }>;
  broker: BrokerDiagnostics;
}

export interface BrokerDiagnostics {
  liveSessions: number;
  /** Total bytes across all per-session ring buffers in the broker client. */
  ringBufferBytes: number;
  /** Number of sessions with batched output pending flush. */
  pendingEmitKeys: number;
  /** Total bytes queued in pendingEmit across all sessions. */
  pendingEmitBytes: number;
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

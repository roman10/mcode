import * as v8 from 'node:v8';
import { app } from 'electron';
import type { IPtyManager } from '../shared/pty-manager-interface';
import type { MemorySnapshot } from '../shared/types';

/**
 * Capture a memory snapshot across the Electron app:
 *  - main process heap + V8 stats
 *  - per-process memory from Electron (main, GPU, renderers, utility, broker)
 *  - broker-side PTY accounting (live sessions, total ring-buffer bytes)
 *
 * Used by the MemoryInspector dev panel and the `app_get_memory_snapshot`
 * MCP tool so coding agents can verify memory fixes empirically.
 */
export function captureMemorySnapshot(ptyManager: IPtyManager): MemorySnapshot {
  const mem = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const heapSpaces = v8.getHeapSpaceStatistics();

  const processes = app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type,
    name: m.name,
    serviceName: m.serviceName,
    cpuPercent: m.cpu?.percentCPUUsage ?? 0,
    memoryWorkingSetKb: m.memory?.workingSetSize ?? 0,
    memoryPeakWorkingSetKb: m.memory?.peakWorkingSetSize ?? 0,
  }));

  return {
    capturedAt: Date.now(),
    main: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    },
    v8: {
      totalHeapSize: heap.total_heap_size,
      usedHeapSize: heap.used_heap_size,
      heapSizeLimit: heap.heap_size_limit,
      mallocedMemory: heap.malloced_memory,
      externalMemory: heap.external_memory,
      heapSpaces: heapSpaces.map((s) => ({
        name: s.space_name,
        size: s.space_size,
        used: s.space_used_size,
      })),
    },
    processes,
    broker: ptyManager.getDiagnostics(),
  };
}

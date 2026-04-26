import { useEffect, useState } from 'react';
import Dialog from './shared/Dialog';
import { terminalRegistry } from '../devtools/terminal-registry';
import type { MemorySnapshot } from '@shared/types';

interface MemoryInspectorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

interface TerminalStat {
  sessionId: string;
  rows: number;
  estBytes: number;
}

const POLL_INTERVAL_MS = 5000;
const BYTES_PER_CELL_ESTIMATE = 4; // crude — accounts for UTF-16 char + attribute overhead

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function collectTerminalStats(): TerminalStat[] {
  const stats: TerminalStat[] = [];
  for (const [sessionId, term] of terminalRegistry) {
    const rows = term.buffer.normal.length;
    const cols = term.cols;
    stats.push({ sessionId, rows, estBytes: rows * cols * BYTES_PER_CELL_ESTIMATE });
  }
  stats.sort((a, b) => b.estBytes - a.estBytes);
  return stats;
}

function MemoryInspector({ open, onOpenChange }: MemoryInspectorProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [terminals, setTerminals] = useState<TerminalStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const snap = await window.mcode.app.getMemorySnapshot();
        if (cancelled) return;
        setSnapshot(snap);
        setTerminals(collectTerminalStats());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Memory Inspector" width="w-[720px]">
      <div className="text-text-primary text-sm space-y-4 max-h-[70vh] overflow-y-auto">
        {error && <div className="text-red-400">Error: {error}</div>}
        {!snapshot && !error && <div className="text-text-muted">Loading…</div>}

        {snapshot && (
          <>
            <Section title="Main process">
              <Row label="RSS" value={formatBytes(snapshot.main.rss)} />
              <Row label="Heap used" value={formatBytes(snapshot.main.heapUsed)} />
              <Row label="Heap total" value={formatBytes(snapshot.main.heapTotal)} />
              <Row label="External" value={formatBytes(snapshot.main.external)} />
              <Row label="ArrayBuffers" value={formatBytes(snapshot.main.arrayBuffers)} />
              <Row label="V8 heap limit" value={formatBytes(snapshot.v8.heapSizeLimit)} />
            </Section>

            <Section title={`Processes (${snapshot.processes.length})`}>
              <table className="w-full text-xs">
                <thead className="text-text-muted">
                  <tr>
                    <th className="text-left py-1">Type</th>
                    <th className="text-left py-1">PID</th>
                    <th className="text-right py-1">CPU %</th>
                    <th className="text-right py-1">Working set</th>
                    <th className="text-right py-1">Peak</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.processes
                    .slice()
                    .sort((a, b) => b.memoryWorkingSetKb - a.memoryWorkingSetKb)
                    .map((p) => (
                      <tr key={`${p.pid}-${p.type}`} className="border-t border-border-default/40">
                        <td className="py-0.5">{p.type}{p.serviceName ? `:${p.serviceName}` : ''}</td>
                        <td className="py-0.5">{p.pid}</td>
                        <td className="py-0.5 text-right">{p.cpuPercent.toFixed(1)}</td>
                        <td className="py-0.5 text-right">{formatBytes(p.memoryWorkingSetKb * 1024)}</td>
                        <td className="py-0.5 text-right">{formatBytes(p.memoryPeakWorkingSetKb * 1024)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Section>

            <Section title="Broker">
              <Row label="Live PTYs" value={String(snapshot.broker.liveSessions)} />
              <Row label="Ring buffers" value={formatBytes(snapshot.broker.ringBufferBytes)} />
              <Row label="Pending emit (sessions)" value={String(snapshot.broker.pendingEmitKeys)} />
              <Row label="Pending emit (bytes)" value={formatBytes(snapshot.broker.pendingEmitBytes)} />
            </Section>

            <Section title={`Renderer terminals (${terminals.length})`}>
              {terminals.length === 0 ? (
                <div className="text-text-muted text-xs">No active terminal instances.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-text-muted">
                    <tr>
                      <th className="text-left py-1">Session</th>
                      <th className="text-right py-1">Buffer rows</th>
                      <th className="text-right py-1">Est. bytes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terminals.map((t) => (
                      <tr key={t.sessionId} className="border-t border-border-default/40">
                        <td className="py-0.5 font-mono">{t.sessionId.slice(0, 8)}</td>
                        <td className="py-0.5 text-right">{t.rows.toLocaleString()}</td>
                        <td className="py-0.5 text-right">{formatBytes(t.estBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <div className="text-text-muted text-xs">
              Polled every {POLL_INTERVAL_MS / 1000}s. Last sample: {new Date(snapshot.capturedAt).toLocaleTimeString()}.
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="text-text-muted text-xs uppercase tracking-wide mb-1">{title}</div>
      <div className="bg-bg-default/40 border border-border-default/40 rounded p-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export default MemoryInspector;

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { PtyManager } from '../main/pty-manager';

interface BrokerRequest {
  id?: string;
  method: string;
  params?: Record<string, unknown>;
}

interface BrokerEvent {
  event: string;
  params?: unknown;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupStale(socketPath: string, pidPath: string): void {
  try {
    const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    if (pid && !isNaN(pid) && isProcessRunning(pid)) {
      // Another broker instance is already running
      return;
    }
  } catch {
    // PID file doesn't exist — stale socket
  }
  try { fs.rmSync(socketPath, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(pidPath, { force: true }); } catch { /* ignore */ }
}

export function runBroker(socketPath: string): Promise<void> {
  const pidPath = socketPath.replace(/\.sock$/, '.pid');

  cleanupStale(socketPath, pidPath);
  fs.writeFileSync(pidPath, String(process.pid), 'utf-8');

  const clients = new Set<net.Socket>();

  function broadcast(msg: BrokerEvent): void {
    const line = JSON.stringify(msg) + '\n';
    for (const client of clients) {
      if (!client.destroyed) {
        try { client.write(line); } catch { /* client disconnected */ }
      }
    }
  }

  const ptyManager = new PtyManager(
    (id, data) => broadcast({ event: 'pty.data', params: { id, data } }),
    (id, exitCode, signal) => broadcast({ event: 'pty.exit', params: { id, code: exitCode, signal } }),
  );

  return new Promise<void>((resolve) => {
    const server = net.createServer((socket) => {
      clients.add(socket);

      // Register error handler BEFORE any writes to avoid unhandled EPIPE
      // (e.g., when a health-check probe connects and immediately disconnects)
      socket.on('error', () => {
        clients.delete(socket);
      });

      if (!socket.destroyed) {
        try {
          socket.write(
            JSON.stringify({
              event: 'broker.hello',
              params: { protocolVersion: 1, pid: process.pid },
            }) + '\n',
          );
        } catch { /* client already gone */ }
      }

      const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
      rl.on('error', () => {}); // Swallow readline errors (e.g., from abrupt disconnects)

      rl.on('line', (line) => {
        let msg: BrokerRequest;
        try {
          msg = JSON.parse(line) as BrokerRequest;
        } catch {
          return;
        }
        handleRequest(msg, socket).catch(() => {});
      });

      socket.on('close', () => {
        clients.delete(socket);
        rl.close();
      });
    });

    async function handleRequest(msg: BrokerRequest, socket: net.Socket): Promise<void> {
      const params = (msg.params ?? {}) as Record<string, unknown>;

      function respond(result: unknown): void {
        if (msg.id && !socket.destroyed) {
          try { socket.write(JSON.stringify({ id: msg.id, result }) + '\n'); } catch { /* disconnected */ }
        }
      }

      function respondError(message: string): void {
        if (msg.id && !socket.destroyed) {
          try { socket.write(JSON.stringify({ id: msg.id, error: { message } }) + '\n'); } catch { /* disconnected */ }
        }
      }

      try {
        switch (msg.method) {
          case 'pty.spawn': {
            const id = params.id as string;
            try {
              ptyManager.spawn({
                id,
                command: params.command as string,
                cwd: params.cwd as string,
                cols: params.cols as number,
                rows: params.rows as number,
                args: params.args as string[] | undefined,
                env: params.env as Record<string, string> | undefined,
                onFirstData: () => broadcast({ event: 'pty.first-data', params: { id } }),
              });
            } catch (spawnErr) {
              // Broadcast exit so SessionManager doesn't wait forever
              broadcast({ event: 'pty.exit', params: { id, code: 1, signal: undefined } });
              console.error(`[pty-broker] spawn failed for ${id}:`, spawnErr);
            }
            // fire-and-forget — no respond()
            break;
          }

          case 'pty.list': {
            respond(ptyManager.listInfo());
            break;
          }

          case 'pty.write': {
            ptyManager.write(params.id as string, params.data as string);
            // fire-and-forget
            break;
          }

          case 'pty.resize': {
            ptyManager.resize(params.id as string, params.cols as number, params.rows as number);
            // fire-and-forget
            break;
          }

          case 'pty.kill': {
            await ptyManager.kill(params.id as string);
            respond(null);
            break;
          }

          case 'pty.kill-all': {
            await ptyManager.killAll();
            respond(null);
            break;
          }

          case 'pty.replay': {
            respond(ptyManager.getReplayData(params.id as string));
            break;
          }

          case 'broker.shutdown': {
            respond(null);
            await ptyManager.killAll();
            server.close();
            try { fs.rmSync(socketPath, { force: true }); } catch { /* ignore */ }
            try { fs.rmSync(pidPath, { force: true }); } catch { /* ignore */ }
            for (const c of clients) c.destroy();
            resolve();
            break;
          }

          default:
            respondError(`Unknown method: ${msg.method}`);
        }
      } catch (e) {
        respondError((e as Error).message);
      }
    }

    server.listen(socketPath, () => {
      console.log(`[pty-broker] Listening on ${socketPath} (pid ${process.pid})`);
    });

    server.on('error', (e) => {
      console.error('[pty-broker] Server error:', e);
    });
  });
}

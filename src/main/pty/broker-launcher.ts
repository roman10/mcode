import * as net from 'node:net';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { app } from 'electron';
import { logger } from '../logger';

const isDev = !app.isPackaged;
const mcodeDir = join(homedir(), isDev ? '.mcode-dev' : '.mcode');

export const BROKER_SOCKET_PATH = join(mcodeDir, 'broker.sock');

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
    socket.once('connect', () => { clearTimeout(timeout); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ensureBroker(socketPath: string): Promise<void> {
  if (await canConnect(socketPath)) {
    logger.info('broker-launcher', 'Broker already running');
    return;
  }

  // Ensure the directory for the socket file exists
  fs.mkdirSync(dirname(socketPath), { recursive: true });

  logger.info('broker-launcher', 'Spawning PTY broker', { socketPath });

  // Run the Electron binary as a plain Node.js process (ELECTRON_RUN_AS_NODE=1)
  // to avoid event loop conflicts between two Electron app instances.
  // The broker entry point is built alongside the main entry by electron-vite.
  const brokerEntryPath = join(__dirname, 'broker-entry.js');
  const logPath = join(dirname(socketPath), 'broker.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [brokerEntryPath, socketPath], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
  fs.closeSync(logFd);

  // Poll until broker socket is ready (up to 5s)
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (await canConnect(socketPath)) {
      logger.info('broker-launcher', 'Broker started');
      return;
    }
  }

  throw new Error('PTY broker failed to start within 5 seconds');
}

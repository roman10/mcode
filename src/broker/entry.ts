/**
 * Standalone PTY broker entry point.
 * Run with: ELECTRON_RUN_AS_NODE=1 <electron-binary> <this-file> <socket-path>
 *
 * This runs as a plain Node.js process (no Electron app lifecycle),
 * avoiding the event loop issues that occur when running two Electron
 * app instances simultaneously.
 */
import { runBroker } from './index';

const socketPath = process.argv[2];
if (!socketPath) {
  console.error('Usage: broker-entry <socket-path>');
  process.exit(1);
}

runBroker(socketPath).then(() => {
  process.exit(0);
}).catch((e) => {
  console.error('[pty-broker] Fatal error:', e);
  process.exit(1);
});

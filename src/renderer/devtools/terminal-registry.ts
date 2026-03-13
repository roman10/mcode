import type { Terminal } from '@xterm/xterm';

/**
 * Global registry of active Terminal instances, keyed by session ID.
 * TerminalInstance registers on mount and unregisters on cleanup.
 * The devtools IPC bridge reads from this to serve buffer requests.
 */
export const terminalRegistry = new Map<string, Terminal>();

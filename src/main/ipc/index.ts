/**
 * Barrel for all IPC handler registration.
 *
 * Each `register*Ipc()` function below wires a domain's typed handlers
 * (defined in `src/shared/ipc-contract-*.ts`) to ipcMain. Service modules
 * elsewhere in `src/main/` contain only domain logic — they no longer
 * register IPC themselves.
 *
 * Add new IPC by:
 *   1. Adding the channel to the relevant `src/shared/ipc-contract-*.ts`
 *   2. Adding the handler in (or creating) `src/main/ipc/<domain>-ipc.ts`
 *   3. Exporting the `register*Ipc` here and calling it from `main/index.ts`
 */

export { registerSessionIpc } from './session-ipc';
export { registerLayoutIpc } from './layout-ipc';
export { registerTaskIpc } from './task-queue-ipc';
export { registerGitChangesIpc } from './git-ipc';
export { registerTokenIpc } from './token-ipc';
export { registerCommitIpc } from './commit-ipc';
export { registerInputIpc } from './input-ipc';
export { registerPtyIpc } from './pty-ipc';
export { registerSearchIpc } from './file-search-ipc';
export { registerFileIpc } from './file-ipc';
export { registerTodoIpc } from './todo-ipc';
export { registerSlashCommandIpc } from './slash-command-ipc';
export { registerSnippetIpc } from './snippet-ipc';
export { registerShellHistoryIpc } from './shell-history-ipc';
export { registerAccountIpc } from './account-ipc';
export { registerQuotaIpc } from './quota-ipc';
export { registerAppIpc } from './app-ipc';
export { registerPreferencesIpc } from './preferences-ipc';
export { registerHookIpc } from './hooks-ipc';

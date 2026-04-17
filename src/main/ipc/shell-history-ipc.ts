import { typedHandle } from '../ipc-helpers';
import { getRecentShellCommands } from '../services/shell-history-reader';

export function registerShellHistoryIpc(): void {
  typedHandle('shell-history:recent', (limit, query) => {
    return getRecentShellCommands({ limit, query });
  });
}

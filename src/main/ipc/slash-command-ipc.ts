import { scanSlashCommands } from '../slash-command-scanner';
import { typedHandle } from '../ipc-helpers';

export function registerSlashCommandIpc(): void {
  typedHandle('slash-commands:scan', (sessionType, cwd) => {
    return scanSlashCommands(sessionType, cwd);
  });
}

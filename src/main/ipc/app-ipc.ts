import { app, dialog, type BrowserWindow } from 'electron';
import { typedHandle } from '../ipc-helpers';
import { captureMemorySnapshot } from '../diagnostics';
import type { AutoUpdater } from '../auto-updater';
import type { BrokerClient } from '../pty/broker-client';

export interface AppIpcDeps {
  appUpdater: AutoUpdater;
  brokerClient: BrokerClient;
  getMainWindow: () => BrowserWindow | null;
  setIsQuitting: (value: boolean) => void;
}

export function registerAppIpc(deps: AppIpcDeps): void {
  const { appUpdater, brokerClient, getMainWindow, setIsQuitting } = deps;

  typedHandle('app:get-version', () => {
    return app.getVersion();
  });

  typedHandle('app:select-directory', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  typedHandle('app:check-for-update', () => appUpdater.checkManual());
  typedHandle('app:open-update-page', () => appUpdater.openReleasePage());
  typedHandle('app:download-update', () => appUpdater.downloadUpdate());
  typedHandle('app:install-update', () => {
    setIsQuitting(true); // bypass close-confirmation dialog before quitAndInstall
    appUpdater.installUpdate();
  });

  typedHandle('app:get-memory-snapshot', () => captureMemorySnapshot(brokerClient));
}

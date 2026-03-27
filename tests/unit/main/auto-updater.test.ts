import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks (hoisted above vi.mock calls) -----------------------------------

const { mockAutoUpdater, eventHandlers, mockShowMessageBox, mockOpenExternal } = vi.hoisted(() => {
  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  return {
    eventHandlers,
    mockAutoUpdater: {
      autoDownload: true as boolean,
      autoInstallOnAppQuit: true as boolean,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers.set(event, handler);
      }),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(),
    },
    mockShowMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
    mockOpenExternal: vi.fn(),
  };
});

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.2.0',
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => mockShowMessageBox(...args),
  },
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}));

vi.mock('../../../src/main/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import { AutoUpdater } from '../../../src/main/auto-updater';

// --- Helpers ---------------------------------------------------------------

function createMockWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
  };
}

// --- Tests -----------------------------------------------------------------

describe('AutoUpdater', () => {
  let wc: ReturnType<typeof createMockWebContents>;
  let updater: AutoUpdater;

  beforeEach(() => {
    vi.useFakeTimers();
    eventHandlers.clear();
    vi.clearAllMocks();
    wc = createMockWebContents();
    updater = new AutoUpdater(() => wc as unknown as Electron.WebContents);
  });

  afterEach(() => {
    updater.stop();
    vi.useRealTimers();
  });

  it('configures autoUpdater on construction', () => {
    expect(mockAutoUpdater.autoDownload).toBe(false);
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(eventHandlers.has('update-available')).toBe(true);
    expect(eventHandlers.has('download-progress')).toBe(true);
    expect(eventHandlers.has('update-downloaded')).toBe(true);
    expect(eventHandlers.has('error')).toBe(true);
  });

  it('start() schedules check after delay then periodically', () => {
    updater.start();

    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

    // After 10s delay
    vi.advanceTimersByTime(10_000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // After 4h interval
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('start() does nothing when app is not packaged', async () => {
    const { app } = await import('electron');
    const orig = app.isPackaged;
    Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });

    const unpackagedUpdater = new AutoUpdater(() => wc as unknown as Electron.WebContents);
    unpackagedUpdater.start();

    vi.advanceTimersByTime(60_000);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

    Object.defineProperty(app, 'isPackaged', { value: orig, configurable: true });
    unpackagedUpdater.stop();
  });

  it('stop() clears timers', () => {
    updater.start();
    updater.stop();

    vi.advanceTimersByTime(60_000);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('check() calls autoUpdater.checkForUpdates()', async () => {
    await updater.check();
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('update-available event sends IPC with version', () => {
    const handler = eventHandlers.get('update-available')!;
    handler({ version: '0.3.0' });

    expect(wc.send).toHaveBeenCalledWith('app:update-available', { version: '0.3.0' });
  });

  it('download-progress event sends IPC with rounded percent', () => {
    const handler = eventHandlers.get('download-progress')!;
    handler({ percent: 45.678 });

    expect(wc.send).toHaveBeenCalledWith('app:update-download-progress', { percent: 46 });
  });

  it('update-downloaded event sends IPC with version', () => {
    const handler = eventHandlers.get('update-downloaded')!;
    handler({ version: '0.3.0' });

    expect(wc.send).toHaveBeenCalledWith('app:update-downloaded', { version: '0.3.0' });
  });

  it('error event sends IPC with message', () => {
    const handler = eventHandlers.get('error')!;
    handler(new Error('Network timeout'));

    expect(wc.send).toHaveBeenCalledWith('app:update-error', { message: 'Network timeout' });
  });

  it('does not send IPC when webContents is destroyed', () => {
    wc.isDestroyed.mockReturnValue(true);
    const handler = eventHandlers.get('update-available')!;
    handler({ version: '0.3.0' });

    expect(wc.send).not.toHaveBeenCalled();
  });

  it('does not send IPC when webContents is null', () => {
    const nullUpdater = new AutoUpdater(() => null);
    const handler = eventHandlers.get('update-available')!;
    wc.send.mockClear();
    handler({ version: '0.3.0' });

    expect(wc.send).not.toHaveBeenCalled();
    nullUpdater.stop();
  });

  it('checkManual() shows up-to-date dialog when no update', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0' },
    });

    await updater.checkManual();

    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        title: 'No Updates Available',
      }),
    );
  });

  it('checkManual() re-sends IPC when update is available', async () => {
    mockAutoUpdater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.3.0' },
    });

    await updater.checkManual();

    expect(mockShowMessageBox).not.toHaveBeenCalled();
    expect(wc.send).toHaveBeenCalledWith('app:update-available', { version: '0.3.0' });
  });

  it('checkManual() shows error dialog on failure', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValue(new Error('fail'));

    await updater.checkManual();

    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Update Check Failed',
      }),
    );
  });

  it('downloadUpdate() calls autoUpdater.downloadUpdate()', () => {
    updater.downloadUpdate();
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledOnce();
  });

  it('installUpdate() calls autoUpdater.quitAndInstall(false, true)', () => {
    updater.installUpdate();
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('openReleasePage() opens GitHub releases URL', () => {
    updater.openReleasePage();
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://github.com/roman10/mcode/releases',
    );
  });
});

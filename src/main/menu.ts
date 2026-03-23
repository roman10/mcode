import { app, Menu } from 'electron';
import type { AppCommand } from '../shared/types';

interface MenuDeps {
  sendCommand: (command: AppCommand) => void;
  shutdownBroker: () => Promise<void>;
  checkForUpdates: () => void;
}

export function buildApplicationMenu({ sendCommand, shutdownBroker, checkForUpdates }: MenuDeps): void {
  // Custom menu with accelerators for app commands.
  // Omit 'close' role so Cmd+W falls through to the renderer for tile close.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => sendCommand({ command: 'show-settings' }),
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: 'Quit and Kill All Sessions',
            accelerator: 'CmdOrCtrl+Shift+Q',
            click: async () => {
              await shutdownBroker();
              app.quit();
            },
          },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'New Session',
            accelerator: 'CmdOrCtrl+N',
            click: () => sendCommand({ command: 'new-session' }),
          },
          {
            label: 'New Terminal',
            accelerator: 'CmdOrCtrl+T',
            click: () => sendCommand({ command: 'new-terminal' }),
          },
          {
            label: 'New Task',
            accelerator: 'CmdOrCtrl+Shift+T',
            click: () => sendCommand({ command: 'show-create-task' }),
          },
          {
            label: 'Run Shell Command',
            accelerator: 'CmdOrCtrl+Shift+E',
            click: () => sendCommand({ command: 'run-shell-command' }),
          },
          {
            label: 'Search in Files',
            accelerator: 'CmdOrCtrl+Shift+F',
            click: () => sendCommand({ command: 'search-in-files' }),
          },
          {
            label: 'Snippets',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => sendCommand({ command: 'open-snippets' }),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Sessions',
        submenu: [
          ...Array.from({ length: 9 }, (_, i) => ({
            label: `Focus Session ${i + 1}`,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => sendCommand({ command: 'focus-session-index', index: i }),
          })),
          { type: 'separator' as const },
          {
            label: 'Focus Next Session',
            accelerator: 'CmdOrCtrl+]',
            click: () => sendCommand({ command: 'focus-next-session' }),
          },
          {
            label: 'Focus Previous Session',
            accelerator: 'CmdOrCtrl+[',
            click: () => sendCommand({ command: 'focus-prev-session' }),
          },
          { type: 'separator' as const },
          {
            label: 'Clear All Attention',
            accelerator: 'CmdOrCtrl+Shift+M',
            click: () => sendCommand({ command: 'clear-all-attention' }),
          },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Sidebar',
            accelerator: 'CmdOrCtrl+\\',
            click: () => sendCommand({ command: 'toggle-sidebar' }),
          },
          {
            label: 'Show Activity',
            accelerator: 'CmdOrCtrl+Shift+A',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'activity' }),
          },
          {
            label: 'Show Commits',
            accelerator: 'CmdOrCtrl+Shift+B',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'commits' }),
          },
          {
            label: 'Show Changes',
            accelerator: 'CmdOrCtrl+Shift+C',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'changes' }),
          },
          {
            label: 'Show Token Usage',
            accelerator: 'CmdOrCtrl+Shift+U',
            click: () => sendCommand({ command: 'switch-sidebar-tab', tab: 'tokens' }),
          },
          {
            label: 'Quick Open',
            accelerator: 'CmdOrCtrl+P',
            click: () => sendCommand({ command: 'quick-open' }),
          },
          {
            label: 'Command Palette',
            accelerator: 'CmdOrCtrl+Shift+P',
            click: () => sendCommand({ command: 'show-command-palette' }),
          },
          { type: 'separator' },
          {
            label: 'Layout Mode',
            submenu: [
              {
                label: 'Tiles',
                type: 'radio',
                checked: true,
                click: () => sendCommand({ command: 'set-view-mode', mode: 'tiles' }),
              },
              {
                label: 'Kanban Board',
                type: 'radio',
                click: () => sendCommand({ command: 'set-view-mode', mode: 'kanban' }),
              },
            ],
          },
          {
            label: 'Toggle Layout Mode',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: () => sendCommand({ command: 'toggle-view-mode' }),
          },
          { type: 'separator' },
          {
            label: 'Close All Tiles',
            accelerator: 'CmdOrCtrl+Shift+X',
            click: () => sendCommand({ command: 'close-all-tiles' }),
          },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Keyboard Shortcuts',
            accelerator: 'CmdOrCtrl+/',
            click: () => sendCommand({ command: 'show-keyboard-shortcuts' }),
          },
          { type: 'separator' },
          {
            label: 'Check for Updates...',
            click: () => checkForUpdates(),
          },
        ],
      },
    ]),
  );
}

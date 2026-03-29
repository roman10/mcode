import { create } from 'zustand';
import type { AgentSessionType } from '@shared/session-agents';

interface DialogState {
  showNewSessionDialog: boolean;
  newSessionDialogType: AgentSessionType;
  showKeyboardShortcuts: boolean;
  showSettings: boolean;
  showAccountsDialog: boolean;
  showCommandPalette: boolean;
  showCreateTaskDialog: boolean;
  quickOpenInitialMode: 'files' | 'commands' | 'shell' | 'snippets';
  /** When set, snippet insertion targets this callback instead of the PTY. */
  textInsertTarget: ((text: string) => void) | null;

  setShowNewSessionDialog(show: boolean): void;
  setNewSessionDialogType(type: AgentSessionType): void;
  setShowKeyboardShortcuts(show: boolean): void;
  setShowSettings(show: boolean): void;
  setShowAccountsDialog(show: boolean): void;
  setShowCommandPalette(show: boolean): void;
  setShowCreateTaskDialog(show: boolean): void;
  openQuickOpen(mode: 'files' | 'commands' | 'shell' | 'snippets'): void;
  setTextInsertTarget(target: ((text: string) => void) | null): void;
}

export const useDialogStore = create<DialogState>((set) => ({
  showNewSessionDialog: false,
  newSessionDialogType: 'claude' as const,
  showKeyboardShortcuts: false,
  showSettings: false,
  showAccountsDialog: false,
  showCommandPalette: false,
  showCreateTaskDialog: false,
  quickOpenInitialMode: 'files' as const,
  textInsertTarget: null,

  setShowNewSessionDialog: (show) => set({ showNewSessionDialog: show }),
  setNewSessionDialogType: (type) => set({ newSessionDialogType: type }),
  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAccountsDialog: (show) => set({ showAccountsDialog: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowCreateTaskDialog: (show) => set({ showCreateTaskDialog: show }),

  openQuickOpen: (mode) => set({ quickOpenInitialMode: mode, showCommandPalette: true }),
  setTextInsertTarget: (target) => set({ textInsertTarget: target }),
}));

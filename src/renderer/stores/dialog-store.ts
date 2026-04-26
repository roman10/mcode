import { create } from 'zustand';
import type { AgentSessionType } from '@shared/session-agents';
import type { Task } from '@shared/types';

export interface CreateTaskDefaults {
  targetSessionId?: string;
  cwd?: string;
  taskType?: 'prompt' | 'planResponse';
  /** When set, the dialog opens in edit mode for this task. */
  editTask?: Task;
}

interface DialogState {
  showNewSessionDialog: boolean;
  newSessionDialogType: AgentSessionType;
  showKeyboardShortcuts: boolean;
  showSettings: boolean;
  showAccountsDialog: boolean;
  showMemoryInspector: boolean;
  showCommandPalette: boolean;
  showCreateTaskDialog: boolean;
  createTaskDefaults: CreateTaskDefaults | null;
  quickOpenInitialMode: 'files' | 'commands' | 'shell' | 'snippets' | 'todos';
  /** When set, snippet insertion targets this callback instead of the PTY. */
  textInsertTarget: ((text: string) => void) | null;

  setShowNewSessionDialog(show: boolean): void;
  setNewSessionDialogType(type: AgentSessionType): void;
  setShowKeyboardShortcuts(show: boolean): void;
  setShowSettings(show: boolean): void;
  setShowAccountsDialog(show: boolean): void;
  setShowMemoryInspector(show: boolean): void;
  setShowCommandPalette(show: boolean): void;
  setShowCreateTaskDialog(show: boolean): void;
  openCreateTaskDialog(defaults?: CreateTaskDefaults): void;
  openQuickOpen(mode: 'files' | 'commands' | 'shell' | 'snippets' | 'todos'): void;
  setTextInsertTarget(target: ((text: string) => void) | null): void;
}

export const useDialogStore = create<DialogState>((set) => ({
  showNewSessionDialog: false,
  newSessionDialogType: 'claude' as const,
  showKeyboardShortcuts: false,
  showSettings: false,
  showAccountsDialog: false,
  showMemoryInspector: false,
  showCommandPalette: false,
  showCreateTaskDialog: false,
  createTaskDefaults: null,
  quickOpenInitialMode: 'files' as const,
  textInsertTarget: null,

  setShowNewSessionDialog: (show) => set({ showNewSessionDialog: show }),
  setNewSessionDialogType: (type) => set({ newSessionDialogType: type }),
  setShowKeyboardShortcuts: (show) => set({ showKeyboardShortcuts: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAccountsDialog: (show) => set({ showAccountsDialog: show }),
  setShowMemoryInspector: (show) => set({ showMemoryInspector: show }),
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowCreateTaskDialog: (show) => set({ showCreateTaskDialog: show, ...(!show && { createTaskDefaults: null }) }),
  openCreateTaskDialog: (defaults) => set({ showCreateTaskDialog: true, createTaskDefaults: defaults ?? null }),

  openQuickOpen: (mode) => set({ quickOpenInitialMode: mode, showCommandPalette: true }),
  setTextInsertTarget: (target) => set({ textInsertTarget: target }),
}));

import { create } from 'zustand';

const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB per command
const SUCCESS_FADE_MS = 5000;
const MAX_COMPLETED_COMMANDS = 50;

export interface EphemeralCommand {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  repo: string; // basename of cwd
  status: 'running' | 'success' | 'error';
  exitCode: number | null;
  output: string;
  startedAt: number;
  endedAt: number | null;
}

interface EphemeralCommandState {
  commands: EphemeralCommand[];
  selectedCommandId: string | null;
  panelExpanded: boolean;
  panelPinned: boolean;
  panelHeight: number;
  autoCollapseScheduled: boolean;

  addCommand(cmd: EphemeralCommand): void;
  appendOutput(sessionId: string, data: string): void;
  completeCommand(sessionId: string, exitCode: number, signal?: number): void;
  selectCommand(id: string | null): void;
  dismissCommand(id: string): void;
  clearCompleted(): void;
  killCommand(id: string): void;
  setPanelExpanded(expanded: boolean): void;
  togglePanelPinned(): void;
  setPanelHeight(height: number): void;
  cancelAutoCollapse(): void;
}

export const useEphemeralCommandStore = create<EphemeralCommandState>((set, get) => ({
  commands: [],
  selectedCommandId: null,
  panelExpanded: false,
  panelPinned: false,
  panelHeight: 200,
  autoCollapseScheduled: false,

  addCommand: (cmd) =>
    set((state) => ({
      commands: [cmd, ...state.commands],
      selectedCommandId: cmd.id,
      panelExpanded: true,
      autoCollapseScheduled: false,
    })),

  appendOutput: (sessionId, data) =>
    set((state) => {
      const idx = state.commands.findIndex((c) => c.sessionId === sessionId);
      if (idx < 0) return state;
      const cmd = state.commands[idx];
      let output = cmd.output + data;
      if (output.length > MAX_OUTPUT_BYTES) {
        output = output.slice(output.length - MAX_OUTPUT_BYTES);
      }
      const updated = [...state.commands];
      updated[idx] = { ...cmd, output };
      return { commands: updated };
    }),

  completeCommand: (sessionId, exitCode) =>
    set((state) => {
      const idx = state.commands.findIndex((c) => c.sessionId === sessionId);
      if (idx < 0) return state;
      const cmd = state.commands[idx];
      if (cmd.status !== 'running') return state;
      const status = exitCode === 0 ? 'success' : 'error';
      const updated = [...state.commands];
      updated[idx] = { ...cmd, status, exitCode, endedAt: Date.now() };

      // Auto-fade successful commands after delay
      if (status === 'success') {
        setTimeout(() => {
          const current = get();
          // Only dismiss if it's still a success (not re-selected)
          const c = current.commands.find((x) => x.sessionId === sessionId);
          if (c?.status === 'success' && current.selectedCommandId !== c.id) {
            get().dismissCommand(c.id);
          }
        }, SUCCESS_FADE_MS);
      }

      // Schedule auto-collapse when not pinned and no running commands remain
      const hasRunning = updated.some((c) => c.status === 'running');
      const shouldScheduleCollapse = !hasRunning && !state.panelPinned && status === 'success';

      // Trim old completed commands
      let trimmed = updated;
      const completedCount = trimmed.filter((c) => c.status !== 'running').length;
      if (completedCount > MAX_COMPLETED_COMMANDS) {
        trimmed = trimmed.slice(0, MAX_COMPLETED_COMMANDS);
      }

      return {
        commands: trimmed,
        autoCollapseScheduled: shouldScheduleCollapse || state.autoCollapseScheduled,
      };
    }),

  selectCommand: (id) =>
    set({ selectedCommandId: id, panelExpanded: id !== null, autoCollapseScheduled: false }),

  dismissCommand: (id) =>
    set((state) => {
      const commands = state.commands.filter((c) => c.id !== id);
      const selectedCommandId =
        state.selectedCommandId === id
          ? (commands[0]?.id ?? null)
          : state.selectedCommandId;
      const panelExpanded =
        commands.length === 0 ? false : state.panelExpanded;
      const autoCollapseScheduled =
        commands.length === 0 ? false : state.autoCollapseScheduled;
      return { commands, selectedCommandId, panelExpanded, autoCollapseScheduled };
    }),

  clearCompleted: () =>
    set((state) => {
      const commands = state.commands.filter((c) => c.status === 'running');
      return {
        commands,
        selectedCommandId: commands[0]?.id ?? null,
        panelExpanded: commands.length > 0 ? state.panelExpanded : false,
        autoCollapseScheduled: false,
      };
    }),

  killCommand: (id) => {
    const cmd = get().commands.find((c) => c.id === id);
    if (cmd && cmd.status === 'running') {
      window.mcode.sessions.kill(cmd.sessionId).catch(console.error);
    }
  },

  setPanelExpanded: (expanded) => set({ panelExpanded: expanded, autoCollapseScheduled: false }),
  togglePanelPinned: () => set((state) => ({ panelPinned: !state.panelPinned })),
  setPanelHeight: (height) => set({ panelHeight: height }),
  cancelAutoCollapse: () => set({ autoCollapseScheduled: false }),
}));

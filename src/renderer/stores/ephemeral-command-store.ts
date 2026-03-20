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

  addCommand(cmd: EphemeralCommand): void;
  appendOutput(sessionId: string, data: string): void;
  completeCommand(sessionId: string, exitCode: number, signal?: number): void;
  selectCommand(id: string | null): void;
  dismissCommand(id: string): void;
  clearCompleted(): void;
  setPanelExpanded(expanded: boolean): void;
  togglePanelPinned(): void;
  setPanelHeight(height: number): void;
}

export const useEphemeralCommandStore = create<EphemeralCommandState>((set, get) => ({
  commands: [],
  selectedCommandId: null,
  panelExpanded: false,
  panelPinned: false,
  panelHeight: 200,

  addCommand: (cmd) =>
    set((state) => ({
      commands: [cmd, ...state.commands],
      selectedCommandId: cmd.id,
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

      // Auto-collapse panel when not pinned and no running commands remain
      const hasRunning = updated.some((c) => c.status === 'running');
      const shouldCollapse = !hasRunning && !state.panelPinned && status === 'success';

      // Trim old completed commands
      let trimmed = updated;
      const completedCount = trimmed.filter((c) => c.status !== 'running').length;
      if (completedCount > MAX_COMPLETED_COMMANDS) {
        trimmed = trimmed.slice(0, MAX_COMPLETED_COMMANDS);
      }

      return {
        commands: trimmed,
        panelExpanded: shouldCollapse ? false : state.panelExpanded,
      };
    }),

  selectCommand: (id) =>
    set({ selectedCommandId: id, panelExpanded: id !== null }),

  dismissCommand: (id) =>
    set((state) => {
      const commands = state.commands.filter((c) => c.id !== id);
      const selectedCommandId =
        state.selectedCommandId === id
          ? (commands[0]?.id ?? null)
          : state.selectedCommandId;
      const panelExpanded =
        commands.length === 0 ? false : state.panelExpanded;
      return { commands, selectedCommandId, panelExpanded };
    }),

  clearCompleted: () =>
    set((state) => {
      const commands = state.commands.filter((c) => c.status === 'running');
      return {
        commands,
        selectedCommandId: commands[0]?.id ?? null,
        panelExpanded: commands.length > 0 ? state.panelExpanded : false,
      };
    }),

  setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),
  togglePanelPinned: () => set((state) => ({ panelPinned: !state.panelPinned })),
  setPanelHeight: (height) => set({ panelHeight: height }),
}));

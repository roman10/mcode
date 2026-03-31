import { create } from 'zustand';

interface SlashCommandWarningState {
  warnings: Record<string, string>;
  setWarning(sessionId: string, message: string): void;
  clearWarning(sessionId: string): void;
}

export const useSlashCommandWarningStore = create<SlashCommandWarningState>((set) => ({
  warnings: {},
  setWarning: (sessionId, message) =>
    set((state) => ({
      warnings: { ...state.warnings, [sessionId]: message },
    })),
  clearWarning: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.warnings;
      return { warnings: rest };
    }),
}));

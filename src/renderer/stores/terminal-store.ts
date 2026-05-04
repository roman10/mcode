import { create } from 'zustand';

interface TerminalState {
  preserveScrollback: boolean;
  setPreserveScrollback(enabled: boolean): void;
  load(): Promise<void>;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  preserveScrollback: false,

  setPreserveScrollback(enabled: boolean): void {
    set({ preserveScrollback: enabled });
    window.mcode.preferences.set('terminalPreserveScrollback', String(enabled)).catch(() => {
      set({ preserveScrollback: !enabled });
    });
  },

  async load(): Promise<void> {
    const val = await window.mcode.preferences.get('terminalPreserveScrollback');
    if (val !== null) {
      set({ preserveScrollback: val === 'true' });
    }
  },
}));

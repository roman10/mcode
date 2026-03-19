import { create } from 'zustand';

interface EditorState {
  vimEnabled: boolean;
  setVimEnabled(enabled: boolean): void;
  load(): Promise<void>;
}

export const useEditorStore = create<EditorState>((set) => ({
  vimEnabled: false,

  setVimEnabled(enabled: boolean): void {
    set({ vimEnabled: enabled });
    window.mcode.preferences.set('editorVimEnabled', String(enabled)).catch(() => {
      set({ vimEnabled: !enabled });
    });
  },

  async load(): Promise<void> {
    const val = await window.mcode.preferences.get('editorVimEnabled');
    if (val !== null) {
      set({ vimEnabled: val === 'true' });
    }
  },
}));

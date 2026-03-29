import { useEffect } from 'react';
import { useDialogStore } from '../stores/dialog-store';

/**
 * Registers the given textarea as the snippet-insertion target while the
 * dialog is open. When a snippet is selected from the command palette, its
 * text will be spliced into the textarea at the current cursor position
 * instead of being written to the terminal PTY.
 */
export function useTextInsertTarget(
  open: boolean,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  setText: (text: string) => void,
  setCursorPos: (pos: number) => void,
): void {
  useEffect(() => {
    if (!open) {
      useDialogStore.getState().setTextInsertTarget(null);
      return;
    }

    const insertAtCursor = (text: string): void => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const current = ta.value;
      const newText = current.substring(0, start) + text + current.substring(end);
      const newPos = start + text.length;
      setText(newText);
      setCursorPos(newPos);
      requestAnimationFrame(() => {
        ta.selectionStart = newPos;
        ta.selectionEnd = newPos;
        ta.focus();
      });
    };

    useDialogStore.getState().setTextInsertTarget(insertAtCursor);
    return () => useDialogStore.getState().setTextInsertTarget(null);
  }, [open, textareaRef, setText, setCursorPos]);
}

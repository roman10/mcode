import { useEffect } from 'react';
import { KEYBOARD_SHORTCUTS, SHORTCUT_CATEGORIES } from '../../shared/keyboard-shortcuts';
import { formatKeys } from '../utils/format-shortcut';
import Dialog from './shared/Dialog';

const isMac = window.mcode.app.getPlatform() === 'darwin';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps): React.JSX.Element {
  // Close on any Cmd/Ctrl+key combo so the user can immediately try a shortcut
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Exclude '/' so Cmd+/ can toggle via the menu accelerator IPC path
      if (mod && e.key !== 'Meta' && e.key !== 'Control' && e.key !== '/') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard Shortcuts"
      width="w-[480px]"
      className="max-h-[70vh] overflow-y-auto"
    >
      {SHORTCUT_CATEGORIES.map((cat) => {
        const entries = KEYBOARD_SHORTCUTS.filter((s) => s.category === cat.id);
        if (entries.length === 0) return null;
        return (
          <div key={cat.id} className="mb-4 last:mb-0">
            <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-2">
              {cat.label}
              {cat.id === 'search' && (
                <span className="normal-case tracking-normal font-normal ml-1">(when search bar is open)</span>
              )}
            </h3>
            <div className="space-y-1">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-sm text-text-primary">{entry.label}</span>
                  <kbd className="bg-bg-primary text-text-secondary text-xs px-1.5 py-0.5 rounded border border-border-default font-mono ml-4 shrink-0">
                    {formatKeys(entry.keys, entry.mod)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex justify-end mt-4">
        <button
          type="button"
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={() => onOpenChange(false)}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}

export default KeyboardShortcutsDialog;

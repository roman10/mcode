import { useEffect } from 'react';
import { KEYBOARD_SHORTCUTS, SHORTCUT_CATEGORIES } from '../../shared/keyboard-shortcuts';
import { formatKeys } from '../utils/format-shortcut';

const isMac = window.mcode.app.getPlatform() === 'darwin';

interface KeyboardShortcutsDialogProps {
  onClose(): void;
}

function KeyboardShortcutsDialog({ onClose }: KeyboardShortcutsDialogProps): React.JSX.Element {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Close on any Cmd/Ctrl+key combo so the user can immediately try a shortcut
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Exclude '/' so Cmd+/ can toggle via the menu accelerator IPC path
      if (mod && e.key !== 'Meta' && e.key !== 'Control' && e.key !== '/') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border-default rounded-lg p-6 w-[480px] max-h-[70vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text-primary text-lg font-medium mb-4">Keyboard Shortcuts</h2>

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
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcutsDialog;

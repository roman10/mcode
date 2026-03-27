import { useEffect, useState, useRef } from 'react';
import { Command, defaultFilter } from 'cmdk';
import { createFocusRestorer } from '../../utils/focus-utils';
import FileSearchItems from './FileSearchItems';
import CommandItems from './CommandItems';
import ShellModeContent from './ShellModeContent';
import SnippetItems from './SnippetItems';

interface CommandPaletteProps {
  initialMode: 'files' | 'commands' | 'shell' | 'snippets';
  onClose(): void;
}

function CommandPalette({ initialMode, onClose }: CommandPaletteProps): React.JSX.Element {
  const [input, setInput] = useState(
    initialMode === 'commands' ? '> '
    : initialMode === 'shell' ? '! '
    : initialMode === 'snippets' ? '@ '
    : '',
  );

  // Derive mode from input value
  const mode = input.startsWith('!')
    ? 'shell'
    : input.startsWith('>')
      ? 'commands'
      : input.startsWith('@')
        ? 'snippets'
        : 'files';
  const searchQuery = mode === 'commands' || mode === 'shell' || mode === 'snippets'
    ? input.slice(1).trimStart()
    : input;

  // Save focus target before we steal focus; restore on unmount
  const restoreFocusRef = useRef(createFocusRestorer());
  useEffect(() => () => restoreFocusRef.current(), []);

  // Explicitly focus the input after mount — autoFocus is unreliable in Electron
  // when xterm.js terminals hold focus (they reclaim it after React's commit phase).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Use setTimeout instead of requestAnimationFrame — rAF is throttled/paused
    // when the Electron window is not in the foreground.
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, []);

  // Escape override for snippet variable form (back to search instead of closing)
  const escapeOverrideRef = useRef<(() => void) | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (escapeOverrideRef.current) {
          escapeOverrideRef.current();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-w-[90vw] bg-bg-elevated border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          loop
          className="[&>label]:hidden"
          shouldFilter={mode === 'commands'}
          filter={(value, search, keywords) => {
            const q = search.startsWith('>') ? search.slice(1).trimStart() : search;
            if (!q) return 1;
            return defaultFilter(value, q, keywords);
          }}
        >
          <Command.Input
            ref={inputRef}
            value={input}
            onValueChange={setInput}
            placeholder={
              mode === 'shell'
                ? '! Type a shell command...'
                : mode === 'commands'
                  ? '> Type a command...'
                  : mode === 'snippets'
                    ? '@ Search snippets...'
                    : 'Search files by name...'
            }
            className="w-full px-4 py-3 bg-transparent text-text-primary text-sm
                       outline-none placeholder:text-text-muted"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto py-1 border-t border-border-subtle">
            {mode === 'snippets' ? (
              <SnippetItems query={searchQuery} onClose={onClose} escapeOverrideRef={escapeOverrideRef} />
            ) : mode === 'shell' ? (
              <ShellModeContent query={searchQuery} onClose={onClose} onSetInput={setInput} />
            ) : mode === 'files' ? (
              <>
                <FileSearchItems query={searchQuery} onClose={onClose} />
                {/* Hints for other modes */}
                {!searchQuery && (
                  <div className="px-4 py-1.5 text-xs text-text-muted border-t border-border-subtle mt-1">
                    Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">!</kbd> to run a shell command
                    {' · '}
                    Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">@</kbd> to insert a snippet
                  </div>
                )}
              </>
            ) : (
              <CommandItems onClose={onClose} />
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export default CommandPalette;

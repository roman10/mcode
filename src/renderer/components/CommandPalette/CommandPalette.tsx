import { useEffect, useState, useRef } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Command, defaultFilter } from 'cmdk';
import FileSearchItems from './FileSearchItems';
import CommandItems from './CommandItems';
import ShellModeContent from './ShellModeContent';
import PromptLibraryItems from './PromptLibraryItems';
import TodoItems from './TodoItems';

interface CommandPaletteProps {
  initialMode: 'files' | 'commands' | 'shell' | 'snippets' | 'todos';
  onClose(): void;
}

function CommandPalette({ initialMode, onClose }: CommandPaletteProps): React.JSX.Element {
  const [input, setInput] = useState(
    initialMode === 'commands' ? '> '
    : initialMode === 'shell' ? '! '
    : initialMode === 'snippets' ? '@ '
    : initialMode === 'todos' ? '+ '
    : '',
  );

  // Derive mode from input value
  const mode = input.startsWith('!')
    ? 'shell'
    : input.startsWith('>')
      ? 'commands'
      : input.startsWith('@')
        ? 'snippets'
        : input.startsWith('+')
          ? 'todos'
          : 'files';
  const searchQuery = mode === 'commands' || mode === 'shell' || mode === 'snippets' || mode === 'todos'
    ? input.slice(1).trimStart()
    : input;

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

  return (
    <RadixDialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/50 animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-[10vh] left-1/2 -translate-x-1/2 z-[60] w-[600px] max-w-[90vw] bg-bg-elevated border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
          onEscapeKeyDown={(e) => {
            if (escapeOverrideRef.current) {
              e.preventDefault();
              escapeOverrideRef.current();
            }
          }}
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
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
                      ? '@ Search prompt library...'
                      : mode === 'todos'
                        ? '+ Add or search TODOs...'
                        : 'Search files by name...'
              }
              className="w-full px-4 py-3 bg-transparent text-text-primary text-sm
                         outline-none placeholder:text-text-muted"
            />
            <Command.List className="max-h-[50vh] overflow-y-auto py-1 border-t border-border-subtle">
              {mode === 'todos' ? (
                <TodoItems query={searchQuery} onClose={onClose} />
              ) : mode === 'snippets' ? (
                <PromptLibraryItems query={searchQuery} onClose={onClose} escapeOverrideRef={escapeOverrideRef} />
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
                      Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">@</kbd> to search prompt library
                      {' · '}
                      Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">+</kbd> to add a TODO
                    </div>
                  )}
                </>
              ) : (
                <CommandItems onClose={onClose} />
              )}
            </Command.List>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export default CommandPalette;

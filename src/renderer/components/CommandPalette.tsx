import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { getCommands } from '../command-palette/command-registry';

interface CommandPaletteProps {
  onClose(): void;
}

function CommandPalette({ onClose }: CommandPaletteProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);

  const commands = getCommands({ sessions, selectedSessionId, mosaicTree });

  // Stable category order
  const categories = ['General', 'Layout', 'Session'] as const;

  // Close on Escape (not using Command.Dialog, so we handle it ourselves)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[520px] bg-bg-elevated border border-border-default rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command loop className="[&>label]:hidden">
          <Command.Input
            autoFocus
            placeholder="Type a command or session name..."
            className="w-full px-4 py-3 bg-transparent text-text-primary text-sm
                       border-b border-border-default outline-none placeholder:text-text-muted"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto py-1">
            <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
              No results found.
            </Command.Empty>
            {categories.map((cat) => {
              const items = commands.filter((c) => c.category === cat);
              if (items.length === 0) return null;
              return (
                <Command.Group
                  key={cat}
                  heading={cat}
                  className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5
                             [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium
                             [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide
                             [&_[cmdk-group-heading]]:text-text-muted"
                >
                  {items.map((cmd) => (
                    <Command.Item
                      key={cmd.id}
                      value={cmd.id}
                      keywords={[cmd.label, ...(cmd.keywords ?? [])]}
                      disabled={!cmd.enabled}
                      onSelect={() => {
                        cmd.execute();
                        onClose();
                      }}
                      className="flex items-center justify-between px-4 py-2 text-sm cursor-pointer
                                 text-text-primary data-[selected=true]:bg-accent/15
                                 data-[disabled=true]:text-text-muted data-[disabled=true]:cursor-not-allowed"
                    >
                      <span>{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd
                          className="ml-4 shrink-0 bg-bg-primary text-text-secondary text-xs
                                     px-1.5 py-0.5 rounded border border-border-default font-mono"
                        >
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export default CommandPalette;

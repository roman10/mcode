import { Command } from 'cmdk';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { getCommands } from './command-registry';

interface CommandItemsProps {
  onClose: () => void;
}

function CommandItems({ onClose }: CommandItemsProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);

  const commands = getCommands({ sessions, selectedSessionId, mosaicTree });
  const categories = ['General', 'Layout', 'Session'] as const;

  return (
    <>
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
                className="flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer
                           text-text-primary data-[selected=true]:bg-accent/20
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
    </>
  );
}

export default CommandItems;

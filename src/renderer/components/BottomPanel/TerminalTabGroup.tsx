import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import TerminalInstance from '../SessionTile/TerminalInstance';
import TerminalTabBar from './TerminalTabBar';

export default function TerminalTabGroup({
  tabGroupId,
}: {
  tabGroupId: string;
}): React.JSX.Element {
  const tabGroup = useTerminalPanelStore((s) => s.tabGroups[tabGroupId]);
  const terminals = useTerminalPanelStore((s) => s.terminals);

  if (!tabGroup) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-xs">No terminal group</div>;
  }

  const activeEntry = terminals[tabGroup.activeTerminalId];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <TerminalTabBar tabGroupId={tabGroupId} />
      <div className="flex-1 min-h-0 min-w-0 pl-1">
        {activeEntry ? (
          // Lazy mounting: only the active tab gets a TerminalInstance.
          // key={sessionId} ensures React unmounts/remounts on tab switch,
          // and TerminalInstance replays from the PTY ring buffer on mount.
          <TerminalInstance
            key={activeEntry.sessionId}
            sessionId={activeEntry.sessionId}
            sessionType="terminal"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
            No active terminal
          </div>
        )}
      </div>
    </div>
  );
}

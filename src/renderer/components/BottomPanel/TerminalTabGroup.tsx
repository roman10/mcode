import { useEffect } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { terminalRegistry } from '../../devtools/terminal-registry';
import TerminalInstance from '../SessionTile/TerminalInstance';
import TerminalTabBar from './TerminalTabBar';

export default function TerminalTabGroup({
  tabGroupId,
}: {
  tabGroupId: string;
}): React.JSX.Element {
  const tabGroup = useTerminalPanelStore((s) => s.tabGroups[tabGroupId]);
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const activeEntry = tabGroup ? terminals[tabGroup.activeTerminalId] : undefined;

  // Auto-focus the xterm terminal when the active terminal changes (new terminal or tab switch).
  const activeSessionId = activeEntry?.sessionId;
  useEffect(() => {
    if (!activeSessionId) return;
    const timer = window.setTimeout(() => {
      terminalRegistry.get(activeSessionId)?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [activeSessionId]);

  if (!tabGroup) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-xs">No terminal group</div>;
  }

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

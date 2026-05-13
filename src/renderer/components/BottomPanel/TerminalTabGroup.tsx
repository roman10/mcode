import { useEffect, useRef } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { terminalRegistry } from '../../devtools/terminal-registry';
import TerminalInstance from '../SessionTile/TerminalInstance';
import TerminalTabBar from './TerminalTabBar';

function TerminalTabSession({
  sessionId,
  isVisible,
}: {
  sessionId: string;
  isVisible: boolean;
}): React.JSX.Element | null {
  const sessionType = useSessionStore((s) => s.sessions[sessionId]?.sessionType);
  if (!sessionType) return null;
  return (
    <TerminalInstance
      sessionId={sessionId}
      sessionType={sessionType}
      isVisible={isVisible}
    />
  );
}

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
  const prevActiveRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeSessionId) return;
    // Route pty input to this session only on a real tab switch — not on initial
    // mount, which would clobber the tile that was selected before the panel mounted.
    if (prevActiveRef.current !== undefined && prevActiveRef.current !== activeSessionId) {
      useSessionStore.getState().setLastFocusedPtySession(activeSessionId);
    }
    prevActiveRef.current = activeSessionId;
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
        {tabGroup.terminalIds.map((tid) => {
          const entry = terminals[tid];
          if (!entry) return null;
          return (
            <TerminalTabSession
              key={entry.sessionId}
              sessionId={entry.sessionId}
              isVisible={tid === tabGroup.activeTerminalId}
            />
          );
        })}
        {!activeEntry && (
          <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
            No active terminal
          </div>
        )}
      </div>
    </div>
  );
}

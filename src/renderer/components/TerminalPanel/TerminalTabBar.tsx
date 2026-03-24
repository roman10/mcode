import { useCallback } from 'react';
import {
  useTerminalPanelStore,
  type TerminalEntry,
} from '../../stores/terminal-panel-store';
import { createTerminalSession } from '../../utils/session-actions';

function TabItem({
  entry,
  isActive,
}: {
  entry: TerminalEntry;
  isActive: boolean;
}): React.JSX.Element {
  const activateTerminal = useTerminalPanelStore((s) => s.activateTerminal);
  const removeTerminal = useTerminalPanelStore((s) => s.removeTerminal);

  const closeTerminal = useCallback(() => {
    window.mcode.sessions.kill(entry.sessionId).catch(() => {});
    removeTerminal(entry.sessionId);
  }, [entry.sessionId, removeTerminal]);

  const handleCloseClick = useCallback(
    (e: React.SyntheticEvent) => {
      e.stopPropagation();
      closeTerminal();
    },
    [closeTerminal],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.stopPropagation();
        closeTerminal();
      }
    },
    [closeTerminal],
  );

  return (
    <button
      type="button"
      className={`
        flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono rounded
        cursor-pointer shrink-0 max-w-[200px] group
        ${isActive ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
      `}
      onClick={() => activateTerminal(entry.sessionId)}
      onMouseDown={handleMiddleClick}
      title={`${entry.label} (${entry.cwd})`}
    >
      <span className="text-text-muted shrink-0">&gt;_</span>
      <span className="truncate">{entry.label}</span>
      {/* Repo badge */}
      <span className="shrink-0 text-xs text-text-muted px-1 rounded bg-bg-primary/50">
        {entry.repo}
      </span>
      {/* Close button */}
      <span
        role="button"
        tabIndex={-1}
        className="shrink-0 ml-0.5 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCloseClick}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); closeTerminal(); } }}
      >
        ×
      </span>
    </button>
  );
}

export default function TerminalTabBar({
  tabGroupId,
}: {
  tabGroupId: string;
}): React.JSX.Element {
  const tabGroup = useTerminalPanelStore((s) => s.tabGroups[tabGroupId]);
  const terminals = useTerminalPanelStore((s) => s.terminals);

  const handleNewTerminal = useCallback(() => {
    createTerminalSession(tabGroupId).catch(console.error);
  }, [tabGroupId]);

  if (!tabGroup) return <div />;

  return (
    <div className="flex items-center gap-1 px-1 py-0.5 overflow-x-auto shrink-0 border-b border-border-subtle">
      {tabGroup.terminalIds.map((tid) => {
        const entry = terminals[tid];
        if (!entry) return null;
        return (
          <TabItem
            key={tid}
            entry={entry}
            isActive={tid === tabGroup.activeTerminalId}
          />
        );
      })}
      {/* New terminal button */}
      <button
        type="button"
        className="shrink-0 px-1.5 py-0.5 text-xs text-text-muted hover:text-text-secondary cursor-pointer rounded hover:bg-bg-secondary"
        onClick={handleNewTerminal}
        title="New terminal (⌘T)"
      >
        +
      </button>
    </div>
  );
}

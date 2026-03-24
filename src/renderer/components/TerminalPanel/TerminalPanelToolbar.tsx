import { useCallback } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import type { SplitDirection } from '../../stores/terminal-panel-store';
import Tooltip from '../shared/Tooltip';
import { formatKeys } from '../../utils/format-shortcut';

export default function TerminalPanelToolbar(): React.JSX.Element {
  const panelPinned = useTerminalPanelStore((s) => s.panelPinned);
  const togglePanelPinned = useTerminalPanelStore((s) => s.togglePanelPinned);
  const setPanelVisible = useTerminalPanelStore((s) => s.setPanelVisible);
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const activeTabGroupId = useTerminalPanelStore((s) => s.activeTabGroupId);
  const tabGroups = useTerminalPanelStore((s) => s.tabGroups);
  const removeTerminal = useTerminalPanelStore((s) => s.removeTerminal);
  const splitTabGroup = useTerminalPanelStore((s) => s.splitTabGroup);

  const activeGroup = activeTabGroupId ? tabGroups[activeTabGroupId] : undefined;
  const activeEntry = activeGroup ? terminals[activeGroup.activeTerminalId] : undefined;

  const handleKill = useCallback(() => {
    if (!activeEntry) return;
    window.mcode.sessions.kill(activeEntry.sessionId).catch(() => {});
    removeTerminal(activeEntry.sessionId);
  }, [activeEntry, removeTerminal]);

  const handleSplit = useCallback(
    (direction: SplitDirection) => {
      if (!activeTabGroupId) return;
      splitTabGroup(activeTabGroupId, direction);
    },
    [activeTabGroupId, splitTabGroup],
  );

  const terminalCount = Object.keys(terminals).length;

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle shrink-0">
      {/* Panel title */}
      <span className="text-xs text-text-secondary font-medium shrink-0">
        Terminal{terminalCount > 1 ? `s (${terminalCount})` : ''}
      </span>

      <div className="flex-1" />

      {/* Actions for active terminal */}
      {activeEntry && (
        <div className="flex items-center gap-1 shrink-0">
          {/* Kill button */}
          <Tooltip content={`Kill terminal (${formatKeys('Shift+W', true)})`} side="top">
            <button
              type="button"
              className="px-1.5 py-0.5 text-xs text-text-muted hover:text-red-400 cursor-pointer"
              onClick={handleKill}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <rect x="1" y="1" width="8" height="8" rx="1" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}

      {/* Split buttons */}
      <Tooltip content={`Split right (${formatKeys('D', true)})`} side="top">
        <button
          type="button"
          className="shrink-0 px-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
          onClick={() => handleSplit('horizontal')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <line x1="8" y1="1" x2="8" y2="15" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip content={`Split down (${formatKeys('Shift+D', true)})`} side="top">
        <button
          type="button"
          className="shrink-0 px-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
          onClick={() => handleSplit('vertical')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="14" height="14" rx="1" />
            <line x1="1" y1="8" x2="15" y2="8" />
          </svg>
        </button>
      </Tooltip>

      {/* Pin toggle */}
      <Tooltip content={panelPinned ? 'Unpin panel (allow auto-collapse)' : 'Pin panel open'} side="top">
        <button
          type="button"
          className={`shrink-0 px-1 text-xs cursor-pointer ${panelPinned ? 'text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          onClick={togglePanelPinned}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            {panelPinned ? (
              <path d="M8 2v5M5 7h6M6 7v3l2 2 2-2V7" />
            ) : (
              <path d="M8 2v5M5 7h6M6 7v3l2 2 2-2V7" opacity="0.5" />
            )}
          </svg>
        </button>
      </Tooltip>

      {/* Collapse button */}
      <Tooltip content={`Collapse panel (${formatKeys('Ctrl+`', false)})`} side="top">
        <button
          type="button"
          className="shrink-0 px-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
          onClick={() => setPanelVisible(false)}
        >
          ▼
        </button>
      </Tooltip>
    </div>
  );
}

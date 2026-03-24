import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  useTerminalPanelStore,
  type TerminalEntry,
} from '../../stores/terminal-panel-store';
import { useSessionStore } from '../../stores/session-store';
import { createTerminalSession } from '../../utils/session-actions';
import Tooltip from '../shared/Tooltip';
import ContextMenu from '../shared/ContextMenu';
import type { MenuItem } from '../shared/ContextMenu';
import { formatKeys } from '../../utils/format-shortcut';

export interface TabItemHandle {
  startEditing(): void;
}

const TabItem = forwardRef<TabItemHandle, {
  entry: TerminalEntry;
  isActive: boolean;
}>(function TabItem({ entry, isActive }, ref) {
  const activateTerminal = useTerminalPanelStore((s) => s.activateTerminal);
  const removeTerminal = useTerminalPanelStore((s) => s.removeTerminal);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const entryLabelRef = useRef(entry.label);
  entryLabelRef.current = entry.label;

  const startEditing = (): void => {
    setEditValue(entryLabelRef.current);
    setIsEditing(true);
  };

  useImperativeHandle(ref, () => ({ startEditing }), []);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRenameSubmit = (): void => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== entry.label) {
      useTerminalPanelStore.getState().updateTerminalLabel(entry.sessionId, trimmed);
      window.mcode.sessions.setLabel(entry.sessionId, trimmed).catch(console.error);
      useSessionStore.getState().setLabel(entry.sessionId, trimmed);
    }
    setIsEditing(false);
  };

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

  const contextMenuItems: MenuItem[] = [
    { label: 'Rename', action: 'rename', shortcut: 'F2' },
    { label: '', action: 'sep1', separator: true },
    { label: 'Kill Terminal', action: 'kill' },
  ];

  const handleContextAction = (action: string): void => {
    switch (action) {
      case 'rename':
        startEditing();
        break;
      case 'kill':
        closeTerminal();
        break;
    }
  };

  const tabButton = (
    <button
      type="button"
      className={`
        flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono rounded
        cursor-pointer shrink-0 max-w-[200px] group
        ${isActive ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
      `}
      onClick={() => activateTerminal(entry.sessionId)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
      onMouseDown={handleMiddleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <span className="text-text-muted shrink-0">&gt;_</span>
      {isEditing ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-bg-primary text-text-primary text-xs font-mono px-1 py-0 h-4 border border-border-focus rounded outline-none"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') {
              setEditValue(entry.label);
              setIsEditing(false);
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate">{entry.label}</span>
      )}
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

  return (
    <>
      {isEditing ? tabButton : (
        <Tooltip content={`${entry.label} (${entry.cwd})`} side="top">
          {tabButton}
        </Tooltip>
      )}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
});

export default function TerminalTabBar({
  tabGroupId,
}: {
  tabGroupId: string;
}): React.JSX.Element {
  const tabGroup = useTerminalPanelStore((s) => s.tabGroups[tabGroupId]);
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const tabRefs = useRef<Record<string, TabItemHandle | null>>({});

  const handleNewTerminal = useCallback(() => {
    createTerminalSession(tabGroupId).catch(console.error);
  }, [tabGroupId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'F2' && tabGroup) {
      e.preventDefault();
      tabRefs.current[tabGroup.activeTerminalId]?.startEditing();
    }
  }, [tabGroup]);

  if (!tabGroup) return <div />;

  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5 overflow-x-auto shrink-0 border-b border-border-subtle"
      onKeyDown={handleKeyDown}
    >
      {tabGroup.terminalIds.map((tid) => {
        const entry = terminals[tid];
        if (!entry) return null;
        return (
          <TabItem
            ref={(handle) => { tabRefs.current[tid] = handle; }}
            key={tid}
            entry={entry}
            isActive={tid === tabGroup.activeTerminalId}
          />
        );
      })}
      {/* New terminal button */}
      <Tooltip content={`New terminal (${formatKeys('T', true)})`} side="top">
        <button
          type="button"
          className="shrink-0 px-1.5 py-0.5 text-xs text-text-muted hover:text-text-secondary cursor-pointer rounded hover:bg-bg-secondary"
          onClick={handleNewTerminal}
        >
          +
        </button>
      </Tooltip>
    </div>
  );
}

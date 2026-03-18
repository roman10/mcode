import { useState, useRef, useCallback, useEffect } from 'react';
import { SquareX, Trash2, BellOff, TerminalSquare, Plus, Settings } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import SessionList from './SessionList';
import TaskQueuePanel from './TaskQueuePanel';
import NewSessionDialog from './NewSessionDialog';
import SettingsDialog from '../SettingsDialog';
import Tooltip from '../shared/Tooltip';
import type { SessionCreateInput } from '../../../shared/types';
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../../../shared/constants';

function Sidebar(): React.JSX.Element {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const addTile = useLayoutStore((s) => s.addTile);
  const removeAllTiles = useLayoutStore((s) => s.removeAllTiles);
  const hasTiles = useLayoutStore((s) => s.mosaicTree !== null);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);
  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hookRuntime = useSessionStore((s) => s.hookRuntime);

  const isMac = window.mcode.app.getPlatform() === 'darwin';
  const modLabel = isMac ? '⌘' : 'Ctrl+';

  const isResizing = useRef(false);

  // Check if any sessions have attention
  const hasAttention = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.attentionLevel !== 'none'),
  );

  // Check if any sessions are ended
  const hasEnded = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.status === 'ended'),
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (me: MouseEvent): void => {
        const newWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + me.clientX - startX),
        );
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = (): void => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        flushPersist();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [flushPersist, sidebarWidth, setSidebarWidth],
  );

  const handleCreate = async (input: SessionCreateInput): Promise<void> => {
    try {
      const session = await window.mcode.sessions.create(input);
      addSession(session);
      addTile(session.sessionId);
      persist();
      selectSession(session.sessionId);
      setShowNewDialog(false);
    } catch (err) {
      console.error('Failed to create session:', err);
      setShowNewDialog(false);
    }
  };

  const handleCreateTerminal = async (): Promise<void> => {
    // Use the cwd of the currently selected session, or fall back to $HOME
    const sessions = useSessionStore.getState().sessions;
    const selectedId = useSessionStore.getState().selectedSessionId;
    const selectedSession = selectedId ? sessions[selectedId] : null;
    const cwd = selectedSession?.cwd || window.mcode.app.getHomeDir();

    try {
      const session = await window.mcode.sessions.create({
        cwd,
        sessionType: 'terminal',
      });
      addSession(session);
      addTile(session.sessionId);
      persist();
      selectSession(session.sessionId);
    } catch (err) {
      console.error('Failed to create terminal:', err);
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    try {
      await window.mcode.sessions.clearAllAttention();
    } catch (err) {
      console.error('Failed to clear attention:', err);
    }
  };

  const handleCloseAllTiles = (): void => {
    removeAllTiles();
    persist();
  };

  const handleDeleteAllEnded = async (): Promise<void> => {
    const endedCount = Object.values(useSessionStore.getState().sessions).filter(
      (s) => s.status === 'ended',
    ).length;
    if (endedCount === 0) return;
    const confirmed = window.confirm(
      `Delete ${endedCount} ended session${endedCount === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await window.mcode.sessions.deleteAllEnded();
    } catch (err) {
      console.error('Failed to delete ended sessions:', err);
    }
  };

  // Global keyboard shortcuts: Cmd+T (new terminal), Cmd+N (new session)
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;

      if (e.key === 't') {
        e.preventDefault();
        handleCreateTerminal();
      } else if (e.key === 'n') {
        e.preventDefault();
        setShowNewDialog(true);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isMac]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div
        className="flex flex-col h-full bg-bg-secondary border-r border-border-default shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border-default">
          <span className="text-sm font-medium text-text-primary">
            Sessions
          </span>
          <div className="flex items-center gap-0.5">
            {hasTiles && (
              <Tooltip content="Close all tiles" side="bottom">
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                  onClick={handleCloseAllTiles}
                >
                  <SquareX size={14} strokeWidth={1.5} />
                </button>
              </Tooltip>
            )}
            {hasEnded && (
              <Tooltip content="Delete ended sessions" side="bottom">
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-elevated transition-colors"
                  onClick={handleDeleteAllEnded}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </Tooltip>
            )}
            {hasAttention && (
              <Tooltip content="Mark all read" side="bottom">
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                  onClick={handleMarkAllRead}
                >
                  <BellOff size={14} strokeWidth={1.5} />
                </button>
              </Tooltip>
            )}
            <Tooltip content={`New terminal (${modLabel}T)`} side="bottom">
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                onClick={handleCreateTerminal}
              >
                <TerminalSquare size={14} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content={`New Claude session (${modLabel}N)`} side="bottom">
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                onClick={() => setShowNewDialog(true)}
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Degraded mode warning */}
        {hookRuntime.state === 'degraded' && (
          <div className="px-3 py-1.5 bg-amber-900/30 text-amber-300 text-xs">
            Live status unavailable
          </div>
        )}

        {/* Session list */}
        <SessionList />

        {/* Task queue */}
        <TaskQueuePanel />

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border-default">
          <span className="text-xs text-text-muted">mcode</span>
          <Tooltip content="Settings" side="top">
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              onClick={() => setShowSettings(true)}
            >
              <Settings size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {showNewDialog && (
        <NewSessionDialog
          onClose={() => setShowNewDialog(false)}
          onCreate={handleCreate}
        />
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}

export default Sidebar;

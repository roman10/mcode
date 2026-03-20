import { useState, useEffect, useCallback } from 'react';
import { SquareX, Trash2, BellOff, TerminalSquare, Plus } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import { useTokenStore } from '../../stores/token-store';
import SessionList from './SessionList';
import TaskQueuePanel from './TaskQueuePanel';
import NewSessionDialog from './NewSessionDialog';
import Tooltip from '../shared/Tooltip';
import DeleteSessionsDialog from './DeleteSessionsDialog';
import CommitStats from '../Dashboard/CommitStats';
import ChangesPanel from '../Dashboard/ChangesPanel';
import TokenStats from '../Dashboard/TokenStats';
import ActivityFeed from '../Dashboard/ActivityFeed';
import { createTerminalSession, autoExpandInKanban } from '../../utils/session-actions';
import type { SessionCreateInput, SessionInfo } from '../../../shared/types';
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../../../shared/constants';

function SidebarPanel(): React.JSX.Element {
  const showNewDialog = useLayoutStore((s) => s.showNewSessionDialog);
  const setShowNewDialog = useLayoutStore((s) => s.setShowNewSessionDialog);
  const splitIntent = useLayoutStore((s) => s.splitIntent);
  const setSplitIntent = useLayoutStore((s) => s.setSplitIntent);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const addTile = useLayoutStore((s) => s.addTile);
  const addTileAdjacent = useLayoutStore((s) => s.addTileAdjacent);
  const removeAllTiles = useLayoutStore((s) => s.removeAllTiles);
  const hasTiles = useLayoutStore((s) => s.mosaicTree !== null);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);
  const todayCost = useTokenStore((s) => s.dailyUsage?.estimatedCostUsd ?? null);
  const refreshTokens = useTokenStore((s) => s.refreshAll);
  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hookRuntime = useSessionStore((s) => s.hookRuntime);

  const isMac = window.mcode.app.getPlatform() === 'darwin';
  const modLabel = isMac ? '⌘' : 'Ctrl+';

  const hasAttention = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.attentionLevel !== 'none'),
  );

  const hasEnded = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.status === 'ended'),
  );

  useEffect(() => {
    refreshTokens();
    const unsub = window.mcode.tokens.onUpdated(() => {
      refreshTokens();
    });
    return unsub;
  }, [refreshTokens]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
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

      if (splitIntent) {
        addTileAdjacent(splitIntent.anchorSessionId, session.sessionId, splitIntent.direction);
        setSplitIntent(null);
      } else {
        addTile(session.sessionId);
      }

      persist();
      selectSession(session.sessionId);
      autoExpandInKanban(session.sessionId);
      setShowNewDialog(false);
    } catch (err) {
      console.error('Failed to create session:', err);
      setShowNewDialog(false);
      setSplitIntent(null);
    }
  };

  const handleCloseDialog = (): void => {
    setShowNewDialog(false);
    setSplitIntent(null);
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

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteBatch = async (sessionIds: string[]): Promise<void> => {
    try {
      await window.mcode.sessions.deleteBatch(sessionIds);
    } catch (err) {
      console.error('Failed to delete sessions:', err);
    } finally {
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <div
        className="flex flex-col h-full bg-bg-secondary border-r border-border-default shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Session actions header */}
        {activeSidebarTab === 'sessions' && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
            <span className="text-xs text-text-secondary uppercase tracking-wide">Sessions</span>
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
                <Tooltip content="Delete ended sessions..." side="bottom">
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-elevated transition-colors"
                    onClick={() => setShowDeleteDialog(true)}
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
                  onClick={() => createTerminalSession().catch(console.error)}
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
        )}

        {/* Tab content headers for non-session tabs */}
        {activeSidebarTab === 'commits' && (
          <div className="flex items-center px-3 py-1.5 border-b border-border-default shrink-0">
            <span className="text-xs text-text-secondary uppercase tracking-wide">Commits</span>
          </div>
        )}
        {activeSidebarTab === 'tokens' && (
          <div className="flex items-center px-3 py-1.5 border-b border-border-default shrink-0">
            <span className="text-xs text-text-secondary uppercase tracking-wide">Tokens</span>
          </div>
        )}
        {activeSidebarTab === 'activity' && (
          <div className="flex items-center px-3 py-1.5 border-b border-border-default shrink-0">
            <span className="text-xs text-text-secondary uppercase tracking-wide">Activity</span>
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeSidebarTab === 'sessions' && (
            <>
              {hookRuntime.state === 'degraded' && (
                <div className="px-3 py-1.5 bg-amber-900/30 text-amber-300 text-xs shrink-0">
                  Live status unavailable
                </div>
              )}
              <SessionList />
              <TaskQueuePanel />
            </>
          )}
          {activeSidebarTab === 'commits' && <CommitStats />}
          {activeSidebarTab === 'changes' && <ChangesPanel />}
          {activeSidebarTab === 'tokens' && <TokenStats />}
          {activeSidebarTab === 'activity' && <ActivityFeed />}
        </div>

        {/* Footer — version and cost only */}
        <div className="flex items-center px-3 py-1.5 border-t border-border-default shrink-0">
          <span className="text-xs text-text-muted">mcode</span>
          {todayCost !== null && todayCost > 0 && (
            <Tooltip content="Estimated token cost today" side="top">
              <span className="text-[11px] text-text-muted ml-1.5">
                ~${todayCost.toFixed(2)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {showNewDialog && (
        <NewSessionDialog
          onClose={handleCloseDialog}
          onCreate={handleCreate}
        />
      )}

      {showDeleteDialog && (
        <DeleteSessionsDialog
          endedSessions={Object.values(useSessionStore.getState().sessions)
            .filter((s): s is SessionInfo => s.status === 'ended')
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
          }
          onClose={() => setShowDeleteDialog(false)}
          onDelete={handleDeleteBatch}
        />
      )}
    </>
  );
}

export default SidebarPanel;

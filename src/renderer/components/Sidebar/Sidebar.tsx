import { useState, useRef, useCallback, useEffect } from 'react';
import { SquareX, Trash2, BellOff, TerminalSquare, Plus, Settings, LayoutList, Activity, GitCommitHorizontal, Coins, Users } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import { useTokenStore } from '../../stores/token-store';
import SessionList from './SessionList';
import TaskQueuePanel from './TaskQueuePanel';
import NewSessionDialog from './NewSessionDialog';
import Tooltip from '../shared/Tooltip';
import DeleteSessionsDialog from './DeleteSessionsDialog';
import CommitStats from '../Dashboard/CommitStats';
import TokenStats from '../Dashboard/TokenStats';
import ActivityFeed from '../Dashboard/ActivityFeed';
import { createTerminalSession } from '../../utils/session-actions';
import type { SessionCreateInput, SessionInfo, SidebarTab } from '../../../shared/types';
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../../../shared/constants';
import { formatKeys } from '../../utils/format-shortcut';

function SidebarTabButton({ icon, tab, active, onSelect, tooltip }: {
  icon: React.ReactNode;
  tab: SidebarTab;
  active: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
  tooltip: string;
}): React.JSX.Element {
  const isActive = active === tab;
  return (
    <Tooltip content={tooltip} side="bottom">
      <button
        className={`w-8 h-8 flex items-center justify-center transition-colors ${
          isActive
            ? 'text-text-primary border-b-2 border-accent'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        onClick={() => onSelect(tab)}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function Sidebar(): React.JSX.Element {
  const setShowSettings = useLayoutStore((s) => s.setShowSettings);
  const setShowAccountsDialog = useLayoutStore((s) => s.setShowAccountsDialog);
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
  const setActiveSidebarTab = useLayoutStore((s) => s.setActiveSidebarTab);
  const todayCost = useTokenStore((s) => s.dailyUsage?.estimatedCostUsd ?? null);
  const refreshTokens = useTokenStore((s) => s.refreshAll);
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

  // Load token data for sidebar running total + subscribe to live updates
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

      // If there's a split intent, insert adjacent; otherwise balanced insert
      if (splitIntent) {
        addTileAdjacent(splitIntent.anchorSessionId, session.sessionId, splitIntent.direction);
        setSplitIntent(null);
      } else {
        addTile(session.sessionId);
      }

      persist();
      selectSession(session.sessionId);
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
        {/* Tab bar */}
        <div className="flex items-center border-b border-border-default shrink-0">
          <div className="flex items-center">
            <SidebarTabButton icon={<LayoutList size={14} strokeWidth={1.5} />} tab="sessions" active={activeSidebarTab} onSelect={setActiveSidebarTab} tooltip="Sessions" />
            <SidebarTabButton icon={<GitCommitHorizontal size={14} strokeWidth={1.5} />} tab="commits" active={activeSidebarTab} onSelect={setActiveSidebarTab} tooltip={`Commits (${formatKeys('Shift+B', true)})`} />
            <SidebarTabButton icon={<Coins size={14} strokeWidth={1.5} />} tab="tokens" active={activeSidebarTab} onSelect={setActiveSidebarTab} tooltip={`Tokens (${formatKeys('Shift+U', true)})`} />
            <SidebarTabButton icon={<Activity size={14} strokeWidth={1.5} />} tab="activity" active={activeSidebarTab} onSelect={setActiveSidebarTab} tooltip={`Activity (${formatKeys('Shift+A', true)})`} />
          </div>
          {activeSidebarTab === 'sessions' && (
            <div className="flex items-center gap-0.5 ml-auto pr-2">
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
          )}
        </div>

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
          {activeSidebarTab === 'tokens' && <TokenStats />}
          {activeSidebarTab === 'activity' && <ActivityFeed />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border-default shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">mcode</span>
            {todayCost !== null && todayCost > 0 && (
              <Tooltip content="Estimated token cost today" side="top">
                <span className="text-[11px] text-text-muted">
                  ~${todayCost.toFixed(2)}
                </span>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip content="Accounts" side="top">
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                onClick={() => setShowAccountsDialog(true)}
              >
                <Users size={14} strokeWidth={1.5} />
              </button>
            </Tooltip>
            <Tooltip content={`Settings (${formatKeys(',', true)})`} side="top">
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                onClick={() => setShowSettings(true)}
              >
                <Settings size={14} strokeWidth={1.5} />
              </button>
            </Tooltip>
          </div>
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

export default Sidebar;

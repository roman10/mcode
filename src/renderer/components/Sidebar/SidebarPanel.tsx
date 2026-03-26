import { useState, useEffect, useCallback, useRef } from 'react';
import { SquareX, Trash2, BellOff, TerminalSquare, Plus, Search, X } from 'lucide-react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import { useAccountsStore } from '../../stores/accounts-store';
import { useStatsStore } from '../../stores/stats-store';
import SessionList from './SessionList';
import NewSessionDialog from './NewSessionDialog';
import Tooltip from '../shared/Tooltip';
import DeleteSessionsDialog from './DeleteSessionsDialog';
import StatsPanel from '../Dashboard/StatsPanel';
import ChangesPanel from '../Dashboard/ChangesPanel';
import CommitGraphPanel from '../CommitGraph/CommitGraphPanel';
import ActivityFeed from '../Dashboard/ActivityFeed';
import SearchPanel from './SearchPanel';
import { createTerminalSession, autoExpandInKanban } from '../../utils/session-actions';
import type { SessionCreateInput, SessionInfo } from '@shared/types';
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@shared/constants';

function SidebarPanel(): React.JSX.Element {
  const showNewDialog = useLayoutStore((s) => s.showNewSessionDialog);
  const setShowNewDialog = useLayoutStore((s) => s.setShowNewSessionDialog);
  const newSessionDialogType = useLayoutStore((s) => s.newSessionDialogType);
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
  const todayCost = useStatsStore((s) => s.dailyUsage?.estimatedCostUsd ?? null);
  const refreshStats = useStatsStore((s) => s.refreshAll);
  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hookRuntime = useSessionStore((s) => s.hookRuntime);
  const sessionFilterQuery = useLayoutStore((s) => s.sessionFilterQuery);
  const setSessionFilterQuery = useLayoutStore((s) => s.setSessionFilterQuery);
  const cliStatus = useAccountsStore((s) => s.cliStatus);
  const cliStatusDismissed = useAccountsStore((s) => s.cliStatusDismissed);
  const dismissCliStatus = useAccountsStore((s) => s.dismissCliStatus);

  const [filterVisible, setFilterVisible] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const isMac = window.mcode.app.getPlatform() === 'darwin';
  const modLabel = isMac ? '⌘' : 'Ctrl+';

  const hasAttention = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.attentionLevel !== 'none'),
  );

  const hasEnded = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.status === 'ended'),
  );

  useEffect(() => {
    refreshStats();
    const unsub1 = window.mcode.tokens.onUpdated(() => { refreshStats(); });
    const unsub2 = window.mcode.commits.onUpdated(() => { refreshStats(); });
    return () => { unsub1(); unsub2(); };
  }, [refreshStats]);

  // Auto-focus filter input when shown
  useEffect(() => {
    if (filterVisible) {
      filterInputRef.current?.focus();
    }
  }, [filterVisible]);

  // Clear filter when switching away from sessions tab
  useEffect(() => {
    if (activeSidebarTab !== 'sessions') {
      setFilterVisible(false);
      setSessionFilterQuery('');
    }
  }, [activeSidebarTab, setSessionFilterQuery]);

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

  const handleNewDialogOpenChange = (open: boolean): void => {
    setShowNewDialog(open);
    if (!open) setSplitIntent(null);
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

  const handleSignIn = async (): Promise<void> => {
    try {
      const s = await window.mcode.sessions.create({
        cwd: window.mcode.app.getHomeDir(),
        label: 'Sign in',
        sessionType: 'terminal',
      });
      addSession(s);
      addTile(s.sessionId);
      persist();
      selectSession(s.sessionId);
      // Send auth command after a brief delay for shell init
      setTimeout(() => window.mcode.pty.write(s.sessionId, 'claude auth login\n'), 300);
    } catch (err) {
      console.error('Failed to open sign-in terminal:', err);
    }
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
        className="flex flex-col h-full bg-bg-secondary shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Session actions header */}
        {activeSidebarTab === 'sessions' && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
            <span className="text-xs text-text-secondary uppercase tracking-wide">Sessions</span>
            <div className="flex items-center gap-0.5">
              <Tooltip content={`Filter sessions (${modLabel}F)`} side="bottom">
                <button
                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                    filterVisible || sessionFilterQuery
                      ? 'text-accent bg-accent/10'
                      : 'text-text-muted hover:text-text-secondary hover:bg-bg-elevated'
                  }`}
                  onClick={() => {
                    if (filterVisible || sessionFilterQuery) {
                      setFilterVisible(false);
                      setSessionFilterQuery('');
                    } else {
                      setFilterVisible(true);
                    }
                  }}
                >
                  <Search size={14} strokeWidth={1.5} />
                </button>
              </Tooltip>
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

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeSidebarTab === 'search' && <SearchPanel />}
          {activeSidebarTab === 'sessions' && (
            <>
              {(filterVisible || sessionFilterQuery) && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-default shrink-0">
                  <Search size={13} className="text-text-muted shrink-0" />
                  <input
                    ref={filterInputRef}
                    type="text"
                    className="flex-1 min-w-0 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                    placeholder="Filter sessions..."
                    value={sessionFilterQuery}
                    onChange={(e) => setSessionFilterQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setFilterVisible(false);
                        setSessionFilterQuery('');
                      }
                    }}
                  />
                  {sessionFilterQuery && (
                    <button
                      className="text-text-muted hover:text-text-secondary transition-colors shrink-0"
                      onClick={() => {
                        setSessionFilterQuery('');
                        filterInputRef.current?.focus();
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )}
              {hookRuntime.state === 'degraded' && (
                <div className="px-3 py-1.5 bg-amber-900/30 text-amber-300 text-xs shrink-0">
                  Live status unavailable
                </div>
              )}
              {cliStatus === 'cli-not-found' && !cliStatusDismissed && (
                <div className="px-3 py-1.5 bg-red-900/30 text-red-300 text-xs shrink-0 flex items-center justify-between gap-2">
                  <span>
                    Claude Code CLI not found.{' '}
                    <button
                      className="underline hover:text-red-200 transition-colors"
                      onClick={() => window.open('https://docs.anthropic.com/en/docs/claude-code/overview', '_blank')}
                    >
                      Install
                    </button>
                  </span>
                  <button className="text-red-400 hover:text-red-200 transition-colors" onClick={dismissCliStatus}>
                    &times;
                  </button>
                </div>
              )}
              {cliStatus === 'not-authenticated' && !cliStatusDismissed && (
                <div className="px-3 py-1.5 bg-amber-900/30 text-amber-300 text-xs shrink-0 flex items-center justify-between gap-2">
                  <span>
                    Not signed in to Claude Code.{' '}
                    <button
                      className="underline hover:text-amber-200 transition-colors"
                      onClick={handleSignIn}
                    >
                      Sign in
                    </button>
                  </span>
                  <button className="text-amber-400 hover:text-amber-200 transition-colors" onClick={dismissCliStatus}>
                    &times;
                  </button>
                </div>
              )}
              <SessionList filterQuery={sessionFilterQuery} />
            </>
          )}
          {activeSidebarTab === 'stats' && <StatsPanel />}
          {activeSidebarTab === 'changes' && (
            <>
              <ChangesPanel />
              <CommitGraphPanel />
            </>
          )}
          {activeSidebarTab === 'activity' && <ActivityFeed />}
        </div>

        {/* Footer — version and cost only */}
        <div className="flex items-center px-3 py-1.5 border-t border-border-default shrink-0">
          <span className="text-xs text-text-muted">mcode</span>
          {todayCost !== null && todayCost > 0 && (
            <Tooltip content="Estimated token cost today" side="top">
              <span className="text-xs text-text-muted ml-1.5">
                ~${todayCost.toFixed(2)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-[1px] shrink-0 cursor-col-resize bg-border-default hover:bg-border-focus transition-colors relative before:absolute before:inset-y-0 before:-left-[3px] before:-right-[3px] before:content-['']"
        onMouseDown={handleMouseDown}
      />

      <NewSessionDialog
        open={showNewDialog}
        initialSessionType={newSessionDialogType}
        onOpenChange={handleNewDialogOpenChange}
        onCreate={handleCreate}
      />

      <DeleteSessionsDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        endedSessions={Object.values(useSessionStore.getState().sessions)
          .filter((s): s is SessionInfo => s.status === 'ended')
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        }
        onDelete={handleDeleteBatch}
      />
    </>
  );
}

export default SidebarPanel;

import { useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore, sessionIdFromTileId } from '../../stores/layout-store';
import { getLeaves } from 'react-mosaic-component';
import SessionCard from './SessionCard';
import type { SessionAttentionLevel, SessionStatus } from '../../../shared/types';

const attentionOrder: Record<SessionAttentionLevel, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const statusOrder: Record<SessionStatus, number> = {
  waiting: 0,
  active: 1,
  starting: 2,
  idle: 3,
  ended: 4,
};

function SessionList(): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const externalSessions = useSessionStore((s) => s.externalSessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);

  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);

  const setExternalSessions = useSessionStore((s) => s.setExternalSessions);

  const [externalExpanded, setExternalExpanded] = useState(false);
  const [externalLimit, setExternalLimit] = useState(20);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // Get set of session IDs that currently have tiles
  const tileSessionIds = new Set(
    mosaicTree
      ? getLeaves(mosaicTree)
          .map(sessionIdFromTileId)
          .filter((id): id is string => id !== null)
      : [],
  );

  // Sort: attention first, then status, then start time
  const sorted = Object.values(sessions).sort(
    (a, b) =>
      (attentionOrder[a.attentionLevel] ?? 9) - (attentionOrder[b.attentionLevel] ?? 9) ||
      (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  const handleDoubleClick = (sessionId: string): void => {
    addTile(sessionId);
    persist();
    selectSession(sessionId);
  };

  const handleKill = async (sessionId: string): Promise<void> => {
    try {
      await window.mcode.sessions.kill(sessionId);
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
  };

  const handleDelete = async (sessionId: string): Promise<void> => {
    const session = sessions[sessionId];
    if (!session) return;
    const confirmed = window.confirm(`Delete session "${session.label}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await window.mcode.sessions.delete(sessionId);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleRename = async (
    sessionId: string,
    label: string,
  ): Promise<void> => {
    try {
      await window.mcode.sessions.setLabel(sessionId, label);
      useSessionStore.getState().setLabel(sessionId, label);
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  };

  const handleLoadMore = async (): Promise<void> => {
    const newLimit = externalLimit + 20;
    setLoadingMore(true);
    try {
      const results = await window.mcode.sessions.listExternal(newLimit);
      setExternalSessions(results);
      setExternalLimit(newLimit);
    } catch (err) {
      console.error('Failed to load more external sessions:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleImportExternal = async (claudeSessionId: string): Promise<void> => {
    // Derive cwd from existing sessions
    const firstClaude = Object.values(sessions).find((s) => s.sessionType === 'claude');
    const cwd = firstClaude?.cwd ?? '';
    if (!cwd) return;

    setImportingId(claudeSessionId);
    try {
      await window.mcode.sessions.importExternal(claudeSessionId, cwd);
    } catch (err) {
      console.error('Failed to import external session:', err);
    } finally {
      setImportingId(null);
    }
  };

  if (sorted.length === 0 && externalSessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <span className="text-text-muted text-sm text-center">
          No sessions yet. Click + to create one.
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-1 px-1">
      {sorted.map((session) => (
        <SessionCard
          key={session.sessionId}
          session={session}
          isSelected={selectedSessionId === session.sessionId}
          hasTile={tileSessionIds.has(session.sessionId)}
          onSelect={() => selectSession(session.sessionId)}
          onDoubleClick={() => handleDoubleClick(session.sessionId)}
          onKill={() => handleKill(session.sessionId)}
          onDelete={() => handleDelete(session.sessionId)}
          onRename={(label) => handleRename(session.sessionId, label)}
        />
      ))}

      {externalSessions.length > 0 && (
        <div className="mt-2 border-t border-border-default pt-2">
          <button
            className="flex items-center gap-1 px-3 py-1 text-xs text-text-muted hover:text-text-secondary w-full"
            onClick={() => setExternalExpanded(!externalExpanded)}
          >
            <span className="text-[10px]">{externalExpanded ? '\u25BC' : '\u25B6'}</span>
            External History ({externalSessions.length}{externalSessions.length >= externalLimit ? '+' : ''})
          </button>

          {externalExpanded && (
            <>
              {externalSessions.map((ext) => (
                <div
                  key={ext.claudeSessionId}
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer hover:bg-bg-secondary"
                  onClick={() => handleImportExternal(ext.claudeSessionId)}
                >
                  <span className="w-2 h-2 rounded-full bg-text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="block text-xs text-text-secondary truncate">
                      {ext.slug}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {ext.startedAt ? new Date(ext.startedAt).toLocaleDateString() : 'Unknown date'}
                    </span>
                  </div>
                  {importingId === ext.claudeSessionId && (
                    <span className="text-[10px] text-text-muted shrink-0">Loading...</span>
                  )}
                </div>
              ))}
              {externalSessions.length >= externalLimit && (
                <button
                  className="w-full px-3 py-1 text-[10px] text-text-muted hover:text-text-secondary"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SessionList;

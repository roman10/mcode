import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore, sessionIdFromTileId } from '../../stores/layout-store';
import { getLeaves } from 'react-mosaic-component';
import SessionCard from './SessionCard';

function SessionList(): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);

  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);

  // Get set of session IDs that currently have tiles
  const tileSessionIds = new Set(
    mosaicTree
      ? getLeaves(mosaicTree)
          .map(sessionIdFromTileId)
          .filter((id): id is string => id !== null)
      : [],
  );

  // Sort: active first, then starting, then ended
  const statusOrder: Record<string, number> = {
    active: 0,
    starting: 1,
    ended: 2,
  };
  const sorted = Object.values(sessions).sort(
    (a, b) =>
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

  if (sorted.length === 0) {
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
          onRename={(label) => handleRename(session.sessionId, label)}
        />
      ))}
    </div>
  );
}

export default SessionList;

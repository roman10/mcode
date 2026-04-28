import { useRef, useEffect } from 'react';
import { useLayoutStore } from '../../stores/layout-store';
import { sessionIdFromTileId, filePathFromTileId, diffPathFromTileId, commitDiffFromTileId } from '../../utils/tile-id';
import { useSessionStore } from '../../stores/session-store';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import TerminalTile from '../SessionTile/TerminalTile';
import FileViewerTile from '../FileViewer/FileViewerTile';
import DiffViewerTile from '../DiffViewer/DiffViewerTile';
import CommitDiffViewerTile from '../DiffViewer/CommitDiffViewerTile';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TileFactoryProps {
  tileId: string;
}

function ClosableTileWrapper({ tileId, children }: { tileId: string; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const removeAnyTile = useLayoutStore((s) => s.removeAnyTile);
  const persist = useLayoutStore((s) => s.persist);
  const isSelected = useLayoutStore((s) => s.selectedTileId === tileId);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    if (isSelected) {
      ref.current?.focus();
    }
  }, [isSelected]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'w') {
      e.preventDefault();
      e.stopPropagation();
      removeAnyTile(tileId);
      persist();
    }
  };

  const handlePointerDown = (): void => {
    useLayoutStore.getState().focusTile(tileId);
  };

  return (
    <div
      ref={ref}
      className={`h-full w-full outline-none border-t-2 transition-colors ${isSelected ? 'border-t-accent' : 'border-t-transparent'}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      data-tile-id={tileId}
    >
      {children}
    </div>
  );
}

function TileFactory({ tileId }: TileFactoryProps): React.JSX.Element {
  // Session tiles handle their own keyboard shortcuts
  const sessionId = sessionIdFromTileId(tileId);

  // Subscribe reactively so the component re-renders when session data loads
  const sessionType = useSessionStore((s) =>
    sessionId ? s.sessions[sessionId]?.sessionType : undefined,
  );

  if (sessionId) {
    // Terminal sessions live in the bottom panel, not in mosaic tiles
    if (sessionType === 'terminal') {
      const handleOpenInPanel = (): void => {
        useTerminalPanelStore.getState().setPanelVisible(true);
        useTerminalPanelStore.getState().activateTerminal(sessionId);
        // Remove this stale tile from the mosaic
        useLayoutStore.getState().removeTile(sessionId);
        useLayoutStore.getState().persist();
      };
      return (
        <div className="flex items-center justify-center h-full w-full text-text-muted text-xs gap-2">
          <span>Terminal moved to bottom panel</span>
          <button
            type="button"
            className="px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 cursor-pointer"
            onClick={handleOpenInPanel}
          >
            Open
          </button>
        </div>
      );
    }
    return <TerminalTile sessionId={sessionId} />;
  }

  // All other tiles get the closable wrapper for Cmd+W support
  let content: React.JSX.Element;
  const filePath = filePathFromTileId(tileId);
  const diffPath = diffPathFromTileId(tileId);
  const commitDiff = commitDiffFromTileId(tileId);
  if (filePath) {
    content = <FileViewerTile absolutePath={filePath} />;
  } else if (commitDiff) {
    content = <CommitDiffViewerTile absolutePath={commitDiff.absolutePath} commitHash={commitDiff.commitHash} />;
  } else if (diffPath) {
    content = <DiffViewerTile absolutePath={diffPath} />;
  } else {
    content = (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Unknown tile: {tileId}
      </div>
    );
  }

  return (
    <ClosableTileWrapper tileId={tileId}>
      {content}
    </ClosableTileWrapper>
  );
}

export default TileFactory;

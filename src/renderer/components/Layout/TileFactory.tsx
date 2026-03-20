import { sessionIdFromTileId, filePathFromTileId, diffPathFromTileId, useLayoutStore } from '../../stores/layout-store';
import TerminalTile from '../Terminal/TerminalTile';
import FileViewerTile from '../FileViewer/FileViewerTile';
import DiffViewerTile from '../DiffViewer/DiffViewerTile';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TileFactoryProps {
  tileId: string;
}

function ClosableTileWrapper({ tileId, children }: { tileId: string; children: React.ReactNode }): React.JSX.Element {
  const removeAnyTile = useLayoutStore((s) => s.removeAnyTile);
  const persist = useLayoutStore((s) => s.persist);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'w') {
      e.preventDefault();
      e.stopPropagation();
      removeAnyTile(tileId);
      persist();
    }
  };

  return (
    <div
      className="h-full w-full outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

function TileFactory({ tileId }: TileFactoryProps): React.JSX.Element {
  // Session tiles handle their own keyboard shortcuts
  const sessionId = sessionIdFromTileId(tileId);
  if (sessionId) {
    return <TerminalTile sessionId={sessionId} />;
  }

  // All other tiles get the closable wrapper for Cmd+W support
  let content: React.JSX.Element;
  const filePath = filePathFromTileId(tileId);
  const diffPath = diffPathFromTileId(tileId);
  if (filePath) {
    content = <FileViewerTile absolutePath={filePath} />;
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

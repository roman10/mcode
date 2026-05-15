import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLeaves } from 'react-mosaic-component';
import { MosaicOverlayContext } from './MosaicLayout';
import { useLayoutStore } from '../../stores/layout-store';
import { sessionIdFromTileId, filePathFromTileId, diffPathFromTileId, commitDiffFromTileId } from '../../utils/tile-id';
import { useSessionStore } from '../../stores/session-store';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import { TileChromeContext } from './TileChromeContext';
import TerminalTile from '../SessionTile/TerminalTile';
import FileViewerTile from '../FileViewer/FileViewerTile';
import DiffViewerTile from '../DiffViewer/DiffViewerTile';
import CommitDiffViewerTile from '../DiffViewer/CommitDiffViewerTile';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TileFactoryProps {
  tileId: string;
}

function ClosableTileWrapper({ tileId, children }: { tileId: string; children: React.ReactNode }): React.JSX.Element {
  // File/diff tiles are stateful (CodeMirror edit/dirty state), so they must be
  // mounted exactly once and only have their DOM reparented. Mirrors
  // TerminalTile: tileBody is portaled into one stable `host` (constant
  // container → no React remount) and that host node is physically moved
  // between the in-tile anchor and the maximize overlay slot.
  const contentRef = useRef<HTMLDivElement>(null);
  const [localTarget, setLocalTarget] = useState<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null) {
    const el = document.createElement('div');
    el.className = 'h-full w-full';
    hostRef.current = el;
  }
  const host = hostRef.current;
  const removeAnyTile = useLayoutStore((s) => s.removeAnyTile);
  const persist = useLayoutStore((s) => s.persist);
  const isSelected = useLayoutStore((s) => s.selectedTileId === tileId);
  const isInMaximized = useLayoutStore(
    (s) => s.maximizedTree != null && getLeaves(s.maximizedTree).includes(tileId),
  );
  const overlayActive = useLayoutStore((s) => s.maximizedTree != null);
  const overlayRegistry = useContext(MosaicOverlayContext);
  const backgroundSlot = overlayRegistry?.getSlot('background', tileId) ?? null;
  const overlaySlot =
    isInMaximized && overlayRegistry ? overlayRegistry.getSlot('overlay', tileId) : null;

  const inOverlay = isInMaximized && overlaySlot !== null;
  // The portaled content lives in a slot. Hide it only while it's parked in
  // the background slot behind an active overlay for ANOTHER tile — never when
  // inOverlay (mutually exclusive: that needs isInMaximized), which would make
  // maximize render blank.
  const hidePortaled = overlayActive && !isInMaximized;
  // Background slot normally; overlay slot when maximized. localTarget is the
  // no-registry fallback (defensive — file/diff tiles only ever mount via
  // MosaicLayout, which always provides the registry).
  const portalTarget = inOverlay
    ? overlaySlot
    : overlayRegistry
      ? backgroundSlot
      : localTarget;

  // contentRef lives inside the Portal, so it's null until `portalTarget`
  // resolves (one render after mount) and changes again on overlay enter/exit.
  // Keying the mount-focus on portalTarget focuses once the content actually
  // attaches — re-focusing it as it follows the tile in/out of the overlay —
  // instead of on a still-null ref on the first render.
  useEffect(() => {
    contentRef.current?.focus();
  }, [portalTarget]);

  useEffect(() => {
    if (isSelected) {
      contentRef.current?.focus();
    }
  }, [isSelected, portalTarget]);

  const handleToggleMaximize = useCallback((): void => {
    const store = useLayoutStore.getState();
    if (store.maximizedTree) {
      store.restoreFromMaximize();
    } else {
      store.maximizeTile(tileId);
    }
  }, [tileId]);

  const chrome = useMemo(
    () => ({ isMaximized: isInMaximized, toggleMaximize: handleToggleMaximize }),
    [isInMaximized, handleToggleMaximize],
  );

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key === 'w') {
      e.preventDefault();
      e.stopPropagation();
      removeAnyTile(tileId);
      persist();
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleToggleMaximize();
    }
  };

  const handlePointerDown = (): void => {
    useLayoutStore.getState().focusTile(tileId);
  };

  // Move the stable host into whichever anchor is active. appendChild on an
  // attached node relocates it without touching the React tree (no remount),
  // before paint.
  useLayoutEffect(() => {
    if (portalTarget && host.parentElement !== portalTarget) {
      portalTarget.appendChild(host);
    }
  }, [portalTarget, host]);

  // The outer div is the React-tree parent for event bubbling only; in tiles
  // mode it sits in MosaicLayout's display:none flat mount and the real
  // content is portaled into a slot. data-tile-id + tabIndex + the hide live
  // on the portaled content (Cmd+[/] focus-by-querySelector resolves it inside
  // the slot; synthetic key/pointer events bubble through the React tree, so
  // the outer handlers still fire across the portal).
  return (
    <div
      className="h-full w-full"
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      {!overlayRegistry && <div ref={setLocalTarget} className="h-full w-full" />}
      {portalTarget &&
        createPortal(
          <div
            ref={contentRef}
            className={`h-full w-full outline-none border-t-2 transition-colors ${isSelected ? 'border-t-accent' : 'border-t-transparent'}`}
            style={hidePortaled ? { display: 'none' } : undefined}
            tabIndex={-1}
            data-tile-id={tileId}
          >
            <TileChromeContext.Provider value={chrome}>
              {children}
            </TileChromeContext.Provider>
          </div>,
          host,
        )}
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

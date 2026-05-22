import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLeaves } from 'react-mosaic-component';
import { useShallow } from 'zustand/react/shallow';
import TerminalToolbar from './TerminalToolbar';
import TileTaskPanel from './TileTaskPanel';
import TerminalInstance from './TerminalInstance';
import SessionEndedPrompt from './SessionEndedPrompt';
import { useLayoutStore } from '../../stores/layout-store';
import { useDialogStore } from '../../stores/dialog-store';
import { useSessionStore } from '../../stores/session-store';
import { terminalRegistry, forceRefit } from '../../devtools/terminal-registry';
import { MosaicOverlayContext } from '../Layout/MosaicLayout';
import { shellEscapePath } from '@shared/shell-utils';
import { scheduleDropPaste } from '../../utils/drop-paste-scheduler';
import { canSessionQueueTasks } from '@shared/session-capabilities';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TerminalTileProps {
  sessionId: string;
}

function TerminalTile({ sessionId }: TerminalTileProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  // The in-tile DOM anchor. The stable host (below) is appended here when the
  // tile is not maximized, and moved to the overlay slot when it is.
  const [localTarget, setLocalTarget] = useState<HTMLDivElement | null>(null);
  // One stable host element, created once and never replaced. tileBody is
  // ALWAYS portaled into this same node (constant containerInfo), then the
  // node itself is physically moved between the in-tile anchor and the
  // maximize overlay slot via appendChild. React remounts a portal's subtree
  // when its container changes, so swapping createPortal targets directly
  // would dispose the xterm Terminal / FitAddon / WebGL atlas every cycle;
  // keeping the container fixed and moving the DOM node preserves them.
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null) {
    const el = document.createElement('div');
    el.className = 'h-full w-full';
    hostRef.current = el;
  }
  const host = hostRef.current;
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const { status, sessionType, hookMode, scrollbackLines } = useSessionStore(
    useShallow((s) => {
      const sess = s.sessions[sessionId];
      return {
        status: sess?.status,
        sessionType: sess?.sessionType,
        hookMode: sess?.hookMode,
        scrollbackLines: sess?.terminalConfig?.scrollbackLines,
      };
    }),
  );

  const canQueueTasks = canSessionQueueTasks(
    sessionType && hookMode && status
      ? { sessionType, hookMode, status }
      : undefined,
  );

  const isFocused = useSessionStore((s) => s.selectedSessionId === sessionId);
  const viewMode = useLayoutStore((s) => s.viewMode);
  const myTileId = `session:${sessionId}`;
  const isInMaximized = useLayoutStore(
    (s) => s.maximizedTree != null && getLeaves(s.maximizedTree).includes(myTileId),
  );
  const overlayActive = useLayoutStore((s) => s.maximizedTree != null);
  const kanbanExpandedSessionId = useLayoutStore((s) => s.kanbanExpandedSessionId);
  const isMaximized =
    viewMode === 'kanban' ? kanbanExpandedSessionId !== null : isInMaximized;
  // In tiles mode, when the overlay is up but this tile isn't part of it, the
  // tile is hidden behind the overlay; keep it mounted but display:none so
  // xterm's renderer skips paint without the isVisible dispose / detach paths.
  const isHiddenByMaximize = viewMode !== 'kanban' && overlayActive && !isInMaximized;
  const overlayRegistry = useContext(MosaicOverlayContext);
  // Reads the latest slots once the relevant <Mosaic> has mounted them. The
  // registry's identity changes on each (de)registration, re-rendering this
  // tile so it picks up its slot one render after the slot appears.
  const backgroundSlot = overlayRegistry?.getSlot('background', myTileId) ?? null;
  const overlaySlot =
    isInMaximized && overlayRegistry ? overlayRegistry.getSlot('overlay', myTileId) : null;

  const handleClose = (): void => {
    if (viewMode === 'kanban') {
      // In kanban mode, closing the expanded terminal returns to the board
      useLayoutStore.getState().clearKanbanExpand();
    } else {
      removeTile(sessionId);
      persist();
    }
  };

  const handleToggleMaximize = (): void => {
    const store = useLayoutStore.getState();
    if (store.viewMode === 'kanban') {
      if (store.kanbanExpandedSessionId) {
        store.clearKanbanExpand();
      } else {
        store.expandKanbanSession(sessionId);
      }
    } else {
      if (store.maximizedTree) {
        store.restoreFromMaximize();
      } else {
        store.maximize(sessionId);
      }
    }
  };

  const handleFocus = (): void => {
    useLayoutStore.getState().focusTile(`session:${sessionId}`);
    // Always focus the xterm textarea — the auto-focus useEffect only fires
    // on isFocused transitions, so re-clicking an already-focused tile needs
    // this direct call to restore terminal focus after transient focus loss.
    terminalRegistry.get(sessionId)?.focus();
  };

  // Drag-and-drop: paste file paths into terminal.
  // Handled at the tile level so drops on the toolbar or task panel also work.
  // No stopPropagation — let react-dnd (react-mosaic) see the events
  // so it can clean up its native drag state after each drop.
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const term = terminalRegistry.get(sessionId);
      if (!term) return;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const fp = window.mcode.app.getPathForFile(files[i]);
        if (fp) paths.push(shellEscapePath(fp));
      }
      scheduleDropPaste(paths, term);
    },
    [sessionId],
  );

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;

    switch (e.key) {
      case 'w':
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          window.mcode.sessions.kill(sessionId).catch(console.error);
        }
        handleClose();
        break;

      case 'd':
        e.preventDefault();
        e.stopPropagation();
        useLayoutStore.getState().setSplitIntent({
          anchorSessionId: sessionId,
          direction: e.shiftKey ? 'column' : 'row',
        });
        useDialogStore.getState().setShowNewSessionDialog(true);
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        handleToggleMaximize();
        break;

      case 'q':
        if (e.shiftKey && canQueueTasks) {
          e.preventDefault();
          e.stopPropagation();
          window.mcode.sessions
            .setAutoClose(sessionId, !useSessionStore.getState().sessions[sessionId]?.autoClose)
            .catch(console.error);
        }
        break;
    }
  };

  // Auto-close the tile when the session *transitions* to ended (not on mount).
  // If a tile is opened for an already-ended session, keep it open with SessionEndedPrompt.
  // Always remove the tile from the mosaic tree regardless of view mode — the kanban
  // expansion is separately auto-collapsed by KanbanLayout's own useEffect.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasEnded = prevStatusRef.current === 'ended';
    prevStatusRef.current = status;
    if (status === 'ended' && !wasEnded) {
      removeTile(sessionId);
      persist();
    }
  }, [status, sessionId, removeTile, persist]);

  // Auto-focus the xterm terminal when this tile becomes the focused session.
  useEffect(() => {
    if (!isFocused) return;
    const timer = window.setTimeout(() => {
      terminalRegistry.get(sessionId)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [isFocused, sessionId]);

  const tileBody = (
    <>
      <TerminalToolbar
        sessionId={sessionId}
        onClose={handleClose}
        isMaximized={isMaximized}
        onToggleMaximize={handleToggleMaximize}
        onRefit={() => forceRefit(sessionId)}
      />
      <TileTaskPanel sessionId={sessionId} />
      <div className="flex-1 min-h-0 min-w-0 pl-1">
        {status === 'ended' ? (
          <SessionEndedPrompt sessionId={sessionId} />
        ) : sessionType ? (
          <TerminalInstance sessionId={sessionId} sessionType={sessionType} scrollbackLines={scrollbackLines} />
        ) : null}
      </div>
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-accent/60 rounded bg-accent/5 pointer-events-none z-10" />
      )}
    </>
  );

  // tileBody is portaled into the stable `host` (constant container → React
  // never remounts the subtree), and `host` is physically reparented between
  // the in-tile anchor and the maximize overlay slot. The xterm Terminal,
  // FitAddon, WebGL atlas, and broker offset therefore survive every
  // maximize/restore cycle. Synthetic events bubble through the React tree,
  // so the outer wrapper's pointer/keyboard/drag handlers still fire on
  // portaled content; no need to duplicate them on the inner div.
  const wrapperClassName = `relative flex flex-col h-full w-full bg-bg-primary outline-none border-t-2 transition-colors ${isFocused ? 'border-t-accent' : 'border-t-transparent'}`;
  const inOverlay = isMaximized && overlaySlot !== null;
  // Hide the portaled content only while it's parked in the background slot
  // behind an overlay for another tile (xterm skips paint, no dispose). Never
  // when inOverlay — isHiddenByMaximize already excludes that case.
  const hidePortaled = isHiddenByMaximize;
  // Background slot normally; overlay slot when maximized. localTarget is the
  // no-registry fallback — this is the Kanban path (KanbanExpandedContent
  // renders TerminalTile outside MosaicLayout's provider), byte-for-byte the
  // pre-refactor behavior.
  const portalTarget = inOverlay
    ? overlaySlot
    : overlayRegistry
      ? backgroundSlot
      : localTarget;

  // Move the stable host into whichever anchor is active. appendChild on an
  // attached node relocates it without affecting the React tree, so no
  // remount. useLayoutEffect runs before paint, avoiding a flash of the
  // terminal at the old location.
  useLayoutEffect(() => {
    if (portalTarget && host.parentElement !== portalTarget) {
      portalTarget.appendChild(host);
    }
  }, [portalTarget, host]);

  // Detach the manually-reparented host on unmount. The portal subtree
  // (TerminalInstance → xterm.dispose) tears down first via React's
  // child-first cleanup order, so by the time this runs the host is an empty
  // shell that no longer needs to stay parented to the slot.
  useLayoutEffect(() => () => { host.remove(); }, [host]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      tabIndex={-1}
      onPointerDown={handleFocus}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Kanban fallback only: in tiles mode the host is reparented into a
          registry slot, so no in-tile anchor is rendered. */}
      {!overlayRegistry && <div ref={setLocalTarget} className="h-full w-full" />}
      {portalTarget &&
        createPortal(
          <div
            className={wrapperClassName}
            style={hidePortaled ? { display: 'none' } : undefined}
          >
            {tileBody}
          </div>,
          host,
        )}
    </div>
  );
}

export default TerminalTile;

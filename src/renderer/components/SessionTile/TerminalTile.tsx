import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // Stable portal target inside this tile. The Portal's children render here
  // when not maximized; switching the target between this and the overlay
  // (maximize) reparents the DOM without remounting React subtree.
  const [localTarget, setLocalTarget] = useState<HTMLDivElement | null>(null);
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
  const maximizedTileId = useLayoutStore((s) => s.maximizedTileId);
  const kanbanExpandedSessionId = useLayoutStore((s) => s.kanbanExpandedSessionId);
  const isMaximized =
    viewMode === 'kanban'
      ? kanbanExpandedSessionId !== null
      : maximizedTileId === myTileId;
  // In tiles mode, when another tile is maximized this tile is hidden under
  // the overlay; we keep it mounted but apply display:none so xterm's renderer
  // skips paint without triggering the isVisible-driven dispose / detach paths.
  const isHiddenByMaximize =
    viewMode !== 'kanban' && maximizedTileId !== null && maximizedTileId !== myTileId;
  const overlayEl = useContext(MosaicOverlayContext);

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
      if (store.maximizedTileId) {
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

  // tileBody lives inside a single Portal whose target switches between an
  // in-tile anchor and the maximize overlay. React reparents a Portal's DOM
  // when only its containerInfo changes — children stay mounted — so the
  // xterm Terminal, FitAddon, WebGL atlas, and broker offset survive every
  // maximize/restore cycle. Synthetic events bubble through the React tree,
  // so the outer wrapper's pointer/keyboard/drag handlers still fire on
  // portaled content; no need to duplicate them on the inner div.
  const wrapperClassName = `relative flex flex-col h-full w-full bg-bg-primary outline-none border-t-2 transition-colors ${isFocused ? 'border-t-accent' : 'border-t-transparent'}`;
  const inOverlay = isMaximized && overlayEl !== null;
  const hideWrapper = isHiddenByMaximize || inOverlay;
  const portalTarget = inOverlay ? overlayEl : localTarget;

  return (
    <div
      ref={containerRef}
      className={wrapperClassName}
      style={hideWrapper ? { display: 'none' } : undefined}
      tabIndex={-1}
      onPointerDown={handleFocus}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Stable in-tile portal anchor. display:contents so its children are
          layout children of the outer wrapper, preserving the flex-column
          arrangement of toolbar / task panel / terminal. */}
      <div ref={setLocalTarget} style={{ display: 'contents' }} />
      {portalTarget &&
        createPortal(
          <div
            className={inOverlay ? wrapperClassName : undefined}
            style={inOverlay ? undefined : { display: 'contents' }}
          >
            {tileBody}
          </div>,
          portalTarget,
        )}
    </div>
  );
}

export default TerminalTile;

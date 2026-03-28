import { useCallback, useEffect, useRef, useState } from 'react';
import TerminalToolbar from './TerminalToolbar';
import TileTaskPanel from './TileTaskPanel';
import TerminalInstance from './TerminalInstance';
import SessionEndedPrompt from './SessionEndedPrompt';
import { useLayoutStore } from '../../stores/layout-store';
import { useDialogStore } from '../../stores/dialog-store';
import { useSessionStore } from '../../stores/session-store';
import { terminalRegistry } from '../../devtools/terminal-registry';
import { shellEscapePath } from '@shared/shell-utils';
import { canSessionQueueTasks } from '@shared/session-capabilities';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TerminalTileProps {
  sessionId: string;
}

function TerminalTile({ sessionId }: TerminalTileProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const status = useSessionStore((s) => s.sessions[sessionId]?.status);
  const sessionType = useSessionStore((s) => s.sessions[sessionId]?.sessionType);
  const hookMode = useSessionStore((s) => s.sessions[sessionId]?.hookMode);
  const scrollbackLines = useSessionStore((s) => s.sessions[sessionId]?.terminalConfig?.scrollbackLines);

  const canQueueTasks = canSessionQueueTasks(
    sessionType && hookMode && status
      ? { sessionType, hookMode, status }
      : undefined,
  );

  const isFocused = useSessionStore((s) => s.selectedSessionId === sessionId);
  const viewMode = useLayoutStore((s) => s.viewMode);
  const isMaximized = useLayoutStore((s) =>
    s.viewMode === 'kanban' ? s.kanbanExpandedSessionId !== null : s.restoreTree !== null,
  );

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
      if (store.restoreTree) {
        store.restoreFromMaximize();
      } else {
        store.maximize(sessionId);
      }
    }
  };

  const handleFocus = (): void => {
    useLayoutStore.getState().focusTile(`session:${sessionId}`);
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
      if (paths.length > 0) {
        term.paste(paths.join(' '));
        term.focus();
      }
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

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col h-full w-full bg-bg-primary outline-none border-t-2 transition-colors ${isFocused ? 'border-t-accent' : 'border-t-transparent'}`}
      tabIndex={-1}
      onPointerDown={handleFocus}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TerminalToolbar sessionId={sessionId} onClose={handleClose} isMaximized={isMaximized} onToggleMaximize={handleToggleMaximize} />
      <TileTaskPanel sessionId={sessionId} />
      <div className="flex-1 min-h-0 min-w-0 pl-1">
        {status === 'ended' ? (
          <SessionEndedPrompt sessionId={sessionId} />
        ) : (
          <TerminalInstance sessionId={sessionId} sessionType={sessionType} scrollbackLines={scrollbackLines} />
        )}
      </div>
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-accent/60 rounded bg-accent/5 pointer-events-none z-10" />
      )}
    </div>
  );
}

export default TerminalTile;

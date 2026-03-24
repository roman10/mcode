import { useCallback, useEffect, useRef, useState } from 'react';
import TerminalToolbar from './TerminalToolbar';
import TileTaskPanel from './TileTaskPanel';
import TerminalInstance from './TerminalInstance';
import SessionEndedPrompt from './SessionEndedPrompt';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import { terminalRegistry } from '../../devtools/terminal-registry';
import { shellEscapePath } from '@shared/shell-utils';

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

interface TerminalTileProps {
  sessionId: string;
}

function TerminalTile({ sessionId }: TerminalTileProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const selectSession = useSessionStore((s) => s.selectSession);
  const status = useSessionStore((s) => s.sessions[sessionId]?.status);
  const sessionType = useSessionStore((s) => s.sessions[sessionId]?.sessionType);
  const scrollbackLines = useSessionStore((s) => s.sessions[sessionId]?.terminalConfig?.scrollbackLines);

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

  // Stable ref for handleClose so the auto-close effect doesn't re-fire on re-renders
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

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
    selectSession(sessionId, 'user');
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
        useLayoutStore.getState().setShowNewSessionDialog(true);
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        handleToggleMaximize();
        break;
    }
  };

  // Auto-close the tile when the session *transitions* to ended (not on mount).
  // If a tile is opened for an already-ended session, keep it open with SessionEndedPrompt.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasEnded = prevStatusRef.current === 'ended';
    prevStatusRef.current = status;
    if (status === 'ended' && !wasEnded) {
      handleCloseRef.current();
    }
  }, [status]);

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

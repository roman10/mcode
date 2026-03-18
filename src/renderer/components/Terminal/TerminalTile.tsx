import { useEffect, useRef } from 'react';
import TerminalToolbar from './TerminalToolbar';
import TerminalInstance from './TerminalInstance';
import SessionEndedPrompt from './SessionEndedPrompt';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';

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

  const handleClose = (): void => {
    removeTile(sessionId);
    persist();
  };

  const handleFocus = (): void => {
    selectSession(sessionId, 'user');
  };

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
        if (useLayoutStore.getState().restoreTree) {
          useLayoutStore.getState().restoreFromMaximize();
        } else {
          useLayoutStore.getState().maximize(sessionId);
        }
        break;
    }
  };

  // Auto-focus the container when the session ends so it can receive keyboard events
  useEffect(() => {
    if (status === 'ended') {
      containerRef.current?.focus();
    }
  }, [status]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full bg-bg-primary outline-none"
      tabIndex={-1}
      onPointerDown={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <TerminalToolbar sessionId={sessionId} onClose={handleClose} />
      <div className="flex-1 min-h-0 min-w-0 pl-1">
        {status === 'ended' ? (
          <SessionEndedPrompt sessionId={sessionId} />
        ) : (
          <TerminalInstance sessionId={sessionId} sessionType={sessionType} scrollbackLines={scrollbackLines} />
        )}
      </div>
    </div>
  );
}

export default TerminalTile;

import { useState, useRef, useCallback } from 'react';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import SessionList from './SessionList';
import NewSessionDialog from './NewSessionDialog';
import type { SessionCreateInput } from '../../../shared/types';
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../../../shared/constants';

function Sidebar(): React.JSX.Element {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);
  const addSession = useSessionStore((s) => s.addSession);
  const selectSession = useSessionStore((s) => s.selectSession);
  const hookRuntime = useSessionStore((s) => s.hookRuntime);

  const isResizing = useRef(false);

  // Check if any sessions have attention
  const hasAttention = useSessionStore((s) =>
    Object.values(s.sessions).some((sess) => sess.attentionLevel !== 'none'),
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (me: MouseEvent): void => {
        const newWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, startWidth + me.clientX - startX),
        );
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = (): void => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        flushPersist();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [flushPersist, sidebarWidth, setSidebarWidth],
  );

  const handleCreate = async (input: SessionCreateInput): Promise<void> => {
    try {
      const session = await window.mcode.sessions.create(input);
      addSession(session);
      addTile(session.sessionId);
      persist();
      selectSession(session.sessionId);
      setShowNewDialog(false);
    } catch (err) {
      console.error('Failed to create session:', err);
      setShowNewDialog(false);
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    try {
      await window.mcode.sessions.clearAllAttention();
    } catch (err) {
      console.error('Failed to clear attention:', err);
    }
  };

  return (
    <>
      <div
        className="flex flex-col h-full bg-bg-secondary border-r border-border-default shrink-0"
        style={{ width: sidebarWidth }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border-default">
          <span className="text-sm font-medium text-text-primary">
            Sessions
          </span>
          <div className="flex items-center gap-1">
            {hasAttention && (
              <button
                className="text-xs text-text-muted hover:text-text-secondary transition-colors px-1"
                title="Mark all read"
                onClick={handleMarkAllRead}
              >
                Clear
              </button>
            )}
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors text-lg leading-none"
              title="New session"
              onClick={() => setShowNewDialog(true)}
            >
              +
            </button>
          </div>
        </div>

        {/* Degraded mode warning */}
        {hookRuntime.state === 'degraded' && (
          <div className="px-3 py-1.5 bg-amber-900/30 text-amber-300 text-xs">
            Live status unavailable
          </div>
        )}

        {/* Session list */}
        <SessionList />

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border-default">
          <span className="text-xs text-text-muted">mcode</span>
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-border-focus/50 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {showNewDialog && (
        <NewSessionDialog
          onClose={() => setShowNewDialog(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  );
}

export default Sidebar;

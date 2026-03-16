import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar/Sidebar';
import MosaicLayout from './components/Layout/MosaicLayout';
import { useSessionStore } from './stores/session-store';
import { useLayoutStore } from './stores/layout-store';

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSessions = useSessionStore((s) => s.setSessions);
  const updateStatus = useSessionStore((s) => s.updateStatus);
  const addSession = useSessionStore((s) => s.addSession);
  const restore = useLayoutStore((s) => s.restore);
  const pruneTiles = useLayoutStore((s) => s.pruneTiles);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);

  // Load sessions and layout on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Load sessions from SQLite
        const allSessions = await window.mcode.sessions.list();
        if (cancelled) return;
        setSessions(allSessions);

        // Restore layout from SQLite
        await restore();
        if (cancelled) return;

        // Prune tiles for ended/missing sessions
        const liveIds = new Set(
          allSessions
            .filter((s) => s.status !== 'ended')
            .map((s) => s.sessionId),
        );
        pruneTiles(liveIds);

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for session status changes from main process
  useEffect(() => {
    const unsub = window.mcode.sessions.onStatusChange(
      (sessionId, status) => {
        updateStatus(sessionId, status);
      },
    );
    return unsub;
  }, [updateStatus]);

  // Listen for sessions created externally (e.g. via MCP devtools)
  useEffect(() => {
    const unsub = window.mcode.sessions.onCreated((session) => {
      addSession(session);
      addTile(session.sessionId);
      persist();
    });
    return unsub;
  }, [addSession, addTile, persist]);

  // Listen for PTY exit events to update session status
  useEffect(() => {
    const unsub = window.mcode.pty.onExit((sessionId) => {
      // Read current state directly to avoid stale closure over sessions
      const session = useSessionStore.getState().sessions[sessionId];
      if (session && session.status !== 'ended') {
        updateStatus(sessionId, 'ended');
      }
    });
    return unsub;
  }, [updateStatus]);

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      flushPersist();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushPersist]);

  if (error) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-red-400">Failed to initialize: {error}</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-text-secondary">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary">
      {/* Title bar drag region */}
      <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />

      {/* Main content: sidebar + mosaic */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex-1 min-w-0">
          <MosaicLayout />
        </div>
      </div>
    </div>
  );
}

export default App;

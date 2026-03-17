import { useEffect, useRef, useState } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import Sidebar from './components/Sidebar/Sidebar';
import MosaicLayout from './components/Layout/MosaicLayout';
import { useSessionStore } from './stores/session-store';
import { useLayoutStore } from './stores/layout-store';

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSessions = useSessionStore((s) => s.setSessions);
  const setExternalSessions = useSessionStore((s) => s.setExternalSessions);
  const upsertSession = useSessionStore((s) => s.upsertSession);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setHookRuntime = useSessionStore((s) => s.setHookRuntime);
  const restore = useLayoutStore((s) => s.restore);
  const pruneTiles = useLayoutStore((s) => s.pruneTiles);
  const addTile = useLayoutStore((s) => s.addTile);
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const flushPersist = useLayoutStore((s) => s.flushPersist);

  // Track previous high-attention count for dock badge
  const prevHighCountRef = useRef(0);
  const prevAttentionBySessionRef = useRef<Record<string, string>>({});

  // Load sessions and layout on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Load sessions from SQLite
        const allSessions = await window.mcode.sessions.list();
        if (cancelled) return;
        setSessions(allSessions);

        // Load hook runtime info
        const runtime = await window.mcode.hooks.getRuntime();
        if (cancelled) return;
        setHookRuntime(runtime);

        // Restore layout from SQLite
        await restore();
        if (cancelled) return;

        // Prune tiles for sessions that no longer exist in the DB
        // (ended sessions are kept so they can show the resume prompt)
        const allIds = new Set(allSessions.map((s) => s.sessionId));
        pruneTiles(allIds);

        // Load external Claude Code sessions (non-blocking, initial page)
        window.mcode.sessions.listExternal(20).then((ext) => {
          if (!cancelled) setExternalSessions(ext);
        }).catch(() => {});

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

  // Listen for full session updates from main process (replaces onStatusChange)
  // Also fires system notifications for newly raised high attention
  useEffect(() => {
    const unsub = window.mcode.sessions.onUpdated((session) => {
      const previousAttention = prevAttentionBySessionRef.current[session.sessionId];
      prevAttentionBySessionRef.current[session.sessionId] = session.attentionLevel;

      upsertSession(session);

      // System notification only when high attention is newly raised.
      if (
        session.attentionLevel === 'high' &&
        previousAttention !== 'high' &&
        !document.hasFocus() &&
        Notification.permission === 'granted'
      ) {
        new Notification('mcode — Attention needed', {
          body: session.attentionReason ?? `Session "${session.label}" needs attention`,
        });
      }
    });
    return unsub;
  }, [upsertSession]);

  // Listen for sessions created externally (e.g. via MCP devtools)
  useEffect(() => {
    const unsub = window.mcode.sessions.onCreated((session) => {
      addSession(session);
      addTile(session.sessionId);
      persist();
    });
    return unsub;
  }, [addSession, addTile, persist]);

  // Listen for sessions deleted (from UI or MCP devtools)
  useEffect(() => {
    const unsub = window.mcode.sessions.onDeleted((sessionId) => {
      removeSession(sessionId);
      removeTile(sessionId);
      persist();
    });
    return unsub;
  }, [removeSession, removeTile, persist]);

  // Listen for batch session deletions
  useEffect(() => {
    const unsub = window.mcode.sessions.onDeletedBatch((sessionIds) => {
      for (const id of sessionIds) {
        removeSession(id);
        removeTile(id);
      }
      persist();
    });
    return unsub;
  }, [removeSession, removeTile, persist]);

  // Dock badge: count of high-attention sessions
  useEffect(() => {
    return useSessionStore.subscribe((state) => {
      const highCount = Object.values(state.sessions).filter(
        (s) => s.attentionLevel === 'high',
      ).length;

      if (highCount !== prevHighCountRef.current) {
        prevHighCountRef.current = highCount;
        window.mcode.app.setDockBadge(highCount > 0 ? String(highCount) : '');
      }
    });
  }, []);

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
    <RadixTooltip.Provider delayDuration={200}>
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
    </RadixTooltip.Provider>
  );
}

export default App;

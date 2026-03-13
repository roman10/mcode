import { useEffect, useState } from 'react';
import TerminalInstance from './components/Terminal/TerminalInstance';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../shared/constants';

function App(): React.JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let killed = false;
    let id: string | null = null;

    window.mcode.pty
      .spawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS })
      .then((sid) => {
        if (killed) {
          // StrictMode re-mount: cleanup already ran, kill the orphan
          window.mcode.pty.kill(sid);
        } else {
          id = sid;
          setSessionId(sid);
        }
      })
      .catch((err: unknown) => {
        if (!killed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      killed = true;
      if (id) {
        window.mcode.pty.kill(id);
      }
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-red-400">Failed to start terminal: {error}</span>
        </div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex flex-col h-screen w-screen bg-bg-primary">
        <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
        <div className="flex flex-1 min-h-0 items-center justify-center">
          <span className="text-text-secondary">Starting terminal...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-bg-primary">
      <div className="h-[38px] shrink-0 [-webkit-app-region:drag]" />
      <div className="flex-1 min-h-0 pl-3">
        <TerminalInstance sessionId={sessionId} />
      </div>
    </div>
  );
}

export default App;

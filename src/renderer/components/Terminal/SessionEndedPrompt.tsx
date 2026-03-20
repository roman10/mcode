import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useAccountsStore } from '../../stores/accounts-store';

interface SessionEndedPromptProps {
  sessionId: string;
}

function SessionEndedPrompt({ sessionId }: SessionEndedPromptProps): React.JSX.Element {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const accounts = useAccountsStore((s) => s.accounts);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [resuming, setResuming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountInitialized = useRef(false);

  const canResume = session?.sessionType === 'claude' && !!session?.claudeSessionId;
  const busy = resuming || creating;

  // Initialize account selector once accounts are available; preserve user's selection after that
  useEffect(() => {
    if (accountInitialized.current) return;
    if (accounts.length === 0) {
      useAccountsStore.getState().refresh();
      return;
    }
    accountInitialized.current = true;
    const defaultAccount = accounts.find((a) => a.isDefault);
    setSelectedAccountId(session?.accountId ?? defaultAccount?.accountId ?? '');
  }, [accounts, session?.accountId]);

  const handleResume = async (): Promise<void> => {
    setResuming(true);
    setError(null);
    try {
      const accountOverride = selectedAccountId || undefined;
      await window.mcode.sessions.resume(sessionId, accountOverride);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResuming(false);
    }
  };

  const handleStartNew = async (): Promise<void> => {
    if (!session) return;
    setCreating(true);
    setError(null);
    try {
      const newSession = await window.mcode.sessions.create({
        cwd: session.cwd,
        permissionMode: session.permissionMode,
        sessionType: session.sessionType,
      });
      useSessionStore.getState().addSession(newSession);
      useLayoutStore.getState().replaceTile(sessionId, newSession.sessionId);
      useLayoutStore.getState().persist();
      useSessionStore.getState().selectSession(newSession.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-4 text-text-secondary">
      <div className="text-sm text-text-muted">
        Session ended{session?.endedAt ? ` at ${new Date(session.endedAt).toLocaleString()}` : ''}
      </div>

      {accounts.length > 1 && canResume && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-muted">Account:</span>
          <select
            className="bg-bg-elevated text-text-primary text-sm px-2 py-1 rounded border border-border-default focus:border-border-focus outline-none"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            disabled={busy}
          >
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.name}{a.email ? ` (${a.email})` : ''}{a.isDefault ? ' — default' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-row gap-3">
        {canResume && (
          <button
            className="px-4 py-2 text-sm bg-bg-elevated hover:bg-bg-tertiary text-text-primary rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleResume}
            disabled={busy}
          >
            {resuming ? 'Resuming...' : 'Resume Session'}
          </button>
        )}
        <button
          className="px-4 py-2 text-sm bg-bg-elevated hover:bg-bg-tertiary text-text-primary rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleStartNew}
          disabled={busy}
        >
          {creating ? 'Starting...' : 'Start New Session'}
        </button>
      </div>

      {!canResume && session?.sessionType !== 'terminal' && (
        <div className="text-xs text-text-muted">
          No Claude session ID recorded — cannot resume
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 max-w-xs text-center">{error}</div>
      )}
    </div>
  );
}

export default SessionEndedPrompt;

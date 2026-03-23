import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAccountsStore } from '../stores/accounts-store';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import Dialog from './shared/Dialog';
import type { AccountProfile, CliAuthStatus } from '@shared/types';

function suggestNameFromEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return localPart;
  const domainParts = domain.split('.');
  const main = domainParts[0];
  const free = new Set(['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail', 'proton']);
  const base = free.has(main.toLowerCase()) ? localPart : main;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

interface AccountRowProps {
  account: AccountProfile;
  authStatus?: CliAuthStatus | null;
  onVerify(): void;
  verifying: boolean;
  onDelete?(): void;
}

function AccountRow({ account, authStatus, onVerify, verifying, onDelete }: AccountRowProps): React.JSX.Element {
  const isVerified = Boolean(account.email);
  const isCliMissing = authStatus === 'cli-not-found';

  const dotColor = isCliMissing ? 'bg-red-400' : isVerified ? 'bg-green-400' : 'bg-amber-400';
  const statusText = isCliMissing
    ? 'CLI not found'
    : account.email ?? 'Not authenticated';
  const statusColor = isCliMissing ? 'text-red-300' : 'text-text-muted';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-bg-primary border border-border-default rounded-md">
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary">{account.name}</span>
          {account.isDefault && (
            <span className="text-xs text-text-muted bg-bg-secondary px-1.5 py-0.5 rounded">
              default
            </span>
          )}
        </div>
        <span className={`text-xs ${statusColor}`}>
          {statusText}
        </span>
      </div>
      <button
        className="text-xs text-text-muted hover:text-text-secondary transition-colors shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={onVerify}
        disabled={verifying}
      >
        {verifying ? 'Checking…' : 'Verify'}
      </button>
      {onDelete && (
        <button
          className="text-text-muted hover:text-red-400 transition-colors shrink-0"
          onClick={onDelete}
        >
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

interface AccountsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function AccountsDialog({ open, onOpenChange }: AccountsDialogProps): React.JSX.Element {
  const accounts = useAccountsStore((s) => s.accounts);
  const refresh = useAccountsStore((s) => s.refresh);
  const addSession = useSessionStore((s) => s.addSession);
  const addTile = useLayoutStore((s) => s.addTile);
  const persist = useLayoutStore((s) => s.persist);
  const selectSession = useSessionStore((s) => s.selectSession);

  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Record<string, CliAuthStatus>>({});

  // Rename prompt state (shown after auth auto-detected)
  const [renameAccountId, setRenameAccountId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const defaultAccount = accounts.find((a) => a.isDefault);
  const secondaryAccounts = accounts.filter((a) => !a.isDefault);

  // One-click add: create account with placeholder name, open auth terminal
  const handleAddAccount = async (): Promise<void> => {
    if (isCreating || pendingAccountId) return;
    setIsCreating(true);
    setError(null);
    try {
      const account = await window.mcode.accounts.create();
      await refresh();

      const sessionId = await window.mcode.accounts.openAuthTerminal(account.accountId);
      const session = await window.mcode.sessions.get(sessionId);
      if (session) {
        addSession(session);
        addTile(session.sessionId);
        persist();
        selectSession(session.sessionId);
      }
      setPendingAccountId(account.accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  // Auto-poll auth status while a pending account exists
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!pendingAccountId) return;
    const intervalId = setInterval(async () => {
      try {
        const result = await window.mcode.accounts.getAuthStatus(pendingAccountId);
        if (result.status === 'ok') {
          await refreshRef.current();
          setPendingAccountId(null);
          if (result.email) {
            setRenameAccountId(pendingAccountId);
            setRenameName(suggestNameFromEmail(result.email));
          }
        }
      } catch {
        // Ignore — terminal/CLI may not be ready yet
      }
    }, 4000);
    return () => clearInterval(intervalId);
  }, [pendingAccountId]);

  // Auto-focus rename input when it appears
  useEffect(() => {
    if (renameAccountId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renameAccountId]);

  const handleRename = useCallback(async (): Promise<void> => {
    if (!renameAccountId || !renameName.trim()) return;
    try {
      await window.mcode.accounts.rename(renameAccountId, renameName.trim());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRenameAccountId(null);
    setRenameName('');
  }, [renameAccountId, renameName, refresh]);

  const handleSkipRename = useCallback((): void => {
    setRenameAccountId(null);
    setRenameName('');
  }, []);

  const handleVerify = async (accountId: string): Promise<void> => {
    setVerifyingId(accountId);
    setError(null);
    try {
      const result = await window.mcode.accounts.getAuthStatus(accountId);
      setAuthStatuses((prev) => ({ ...prev, [accountId]: result.status }));
      await refresh();
      // Also refresh sidebar CLI status
      useAccountsStore.getState().refreshCliStatus().catch(() => {});
      if (pendingAccountId === accountId && result.status === 'ok') setPendingAccountId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async (accountId: string): Promise<void> => {
    setDeletingId(accountId);
    setError(null);
    try {
      await window.mcode.accounts.delete(accountId);
      if (pendingAccountId === accountId) setPendingAccountId(null);
      if (renameAccountId === accountId) {
        setRenameAccountId(null);
        setRenameName('');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      closeOnOverlayClick={false}
      title="Accounts"
      width="w-[460px]"
      className="max-h-[80vh] overflow-y-auto"
    >
      {/* Default account */}
      <div className="mb-4">
        <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Default Account</p>
        {defaultAccount && (
          <>
            <AccountRow
              account={defaultAccount}
              authStatus={authStatuses[defaultAccount.accountId]}
              onVerify={() => handleVerify(defaultAccount.accountId)}
              verifying={verifyingId === defaultAccount.accountId}
            />
            {authStatuses[defaultAccount.accountId] === 'cli-not-found' && (
              <div className="mt-2 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-md text-xs text-red-300">
                The <code className="bg-red-900/30 px-1 rounded">claude</code> command was not found in your PATH. Install Claude Code CLI to get started.
                <button
                  className="ml-2 underline hover:text-red-200 transition-colors"
                  onClick={() => window.open('https://docs.anthropic.com/en/docs/claude-code/overview', '_blank')}
                >
                  Install Instructions
                </button>
              </div>
            )}
            {authStatuses[defaultAccount.accountId] === 'not-authenticated' && !defaultAccount.email && (
              <div className="mt-2 px-3 py-2 bg-amber-900/20 border border-amber-700/30 rounded-md text-xs text-amber-300">
                Run <code className="bg-amber-900/30 px-1 rounded">claude auth login</code> in a terminal to authenticate.
              </div>
            )}
          </>
        )}
      </div>

      {/* Secondary accounts */}
      {secondaryAccounts.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Secondary Accounts</p>
          <div className="space-y-2">
            {secondaryAccounts.map((account) => (
              <AccountRow
                key={account.accountId}
                account={account}
                authStatus={authStatuses[account.accountId]}
                onVerify={() => handleVerify(account.accountId)}
                verifying={verifyingId === account.accountId}
                onDelete={
                  deletingId === account.accountId
                    ? undefined
                    : () => handleDelete(account.accountId)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending auth notice */}
      {pendingAccountId && (
        <div className="mb-4 px-3 py-2.5 bg-amber-900/20 border border-amber-700/30 rounded-md text-xs text-amber-300">
          Complete the authentication flow in your browser. This will update automatically.
        </div>
      )}

      {/* Rename prompt (shown after auth auto-detected) */}
      {renameAccountId && (
        <div className="mb-4 space-y-2">
          <p className="text-xs text-text-muted uppercase tracking-wide">Name your account</p>
          <input
            ref={renameInputRef}
            className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Account name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                e.stopPropagation();
                handleSkipRename();
              }
            }}
          />
          <div className="flex gap-2">
            <button
              className="flex-1 px-3 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
              disabled={!renameName.trim()}
              onClick={handleRename}
            >
              Save Name
            </button>
            <button
              className="px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              onClick={handleSkipRename}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-md text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Add account — one-click button */}
      {!renameAccountId && (
        <button
          className="mb-4 text-sm text-text-muted hover:text-text-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleAddAccount}
          disabled={isCreating || Boolean(pendingAccountId)}
        >
          {isCreating ? 'Creating…' : '+ Add Account'}
        </button>
      )}

      {/* Footer */}
      <div className="flex justify-end">
        <button
          className="inline-flex items-center px-4 py-2 text-sm bg-bg-secondary text-text-secondary border border-border-default rounded hover:bg-bg-elevated transition-colors"
          onClick={() => onOpenChange(false)}
        >
          Done
          <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
        </button>
      </div>
    </Dialog>
  );
}

export default AccountsDialog;

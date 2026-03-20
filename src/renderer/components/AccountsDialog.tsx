import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAccountsStore } from '../stores/accounts-store';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import Dialog from './shared/Dialog';
import type { AccountProfile } from '../../shared/types';

interface AccountRowProps {
  account: AccountProfile;
  onVerify(): void;
  verifying: boolean;
  onDelete?(): void;
}

function AccountRow({ account, onVerify, verifying, onDelete }: AccountRowProps): React.JSX.Element {
  const isVerified = Boolean(account.email);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-bg-primary border border-border-default rounded-md">
      <div className={`w-2 h-2 rounded-full shrink-0 ${isVerified ? 'bg-green-400' : 'bg-amber-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary">{account.name}</span>
          {account.isDefault && (
            <span className="text-xs text-text-muted bg-bg-secondary px-1.5 py-0.5 rounded">
              default
            </span>
          )}
        </div>
        <span className="text-xs text-text-muted">
          {account.email ?? 'Not authenticated'}
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

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultAccount = accounts.find((a) => a.isDefault);
  const secondaryAccounts = accounts.filter((a) => !a.isDefault);

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const account = await window.mcode.accounts.create(newName.trim());
      await refresh();
      setShowAddForm(false);
      setNewName('');

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

  // Cmd+Enter to submit add form — use ref to avoid stale closure
  const handleCreateRef = useRef(handleCreate);
  handleCreateRef.current = handleCreate;

  useEffect(() => {
    if (!open || !showAddForm) return;
    const isMac = navigator.userAgent.includes('Mac');
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        handleCreateRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, showAddForm]);

  const handleVerify = async (accountId: string): Promise<void> => {
    setVerifyingId(accountId);
    setError(null);
    try {
      const status = await window.mcode.accounts.getAuthStatus(accountId);
      await refresh();
      if (pendingAccountId === accountId && status.loggedIn) setPendingAccountId(null);
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
          <AccountRow
            account={defaultAccount}
            onVerify={() => handleVerify(defaultAccount.accountId)}
            verifying={verifyingId === defaultAccount.accountId}
          />
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
          A terminal opened with the account&apos;s environment. Run{' '}
          <code className="bg-bg-primary px-1 rounded font-mono">claude auth login</code>{' '}
          there, then click Verify on the account row above.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-md text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Add account */}
      {showAddForm ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs text-text-muted uppercase tracking-wide">Add Account</p>
          <input
            className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Account name (e.g. Work Pro)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowAddForm(false);
                setNewName('');
              }
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <div className="flex gap-2">
            <button
              className="flex-1 px-3 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
              disabled={!newName.trim() || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? 'Creating…' : 'Create & Open Auth Terminal'}
            </button>
            <button
              className="px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              onClick={() => {
                setShowAddForm(false);
                setNewName('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mb-4 text-sm text-text-muted hover:text-text-secondary transition-colors"
          onClick={() => setShowAddForm(true)}
        >
          + Add Account
        </button>
      )}

      {/* Footer */}
      <div className="flex justify-end">
        <button
          className="px-4 py-2 text-sm bg-bg-secondary text-text-secondary border border-border-default rounded hover:bg-bg-elevated transition-colors"
          onClick={() => onOpenChange(false)}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}

export default AccountsDialog;

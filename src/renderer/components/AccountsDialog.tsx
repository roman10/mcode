import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCw, Trash2 } from 'lucide-react';
import { useAccountsStore } from '../stores/accounts-store';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { getAgentDefinition, AGENT_SESSION_TYPES } from '@shared/session-agents';
import type { AgentDefinition } from '@shared/session-agents';
import Dialog from './shared/Dialog';
import type { AccountProfileWithProviders, AccountProviderIdentity, CliAuthStatus } from '@shared/types';

// Providers that support account profiles — derived from agent metadata.
const SUPPORTED_PROVIDERS: AgentDefinition[] = AGENT_SESSION_TYPES
  .map((t) => getAgentDefinition(t)!)
  .filter((d) => d.supportsAccountProfiles);

function suggestNameFromEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return localPart;
  const domainParts = domain.split('.');
  const main = domainParts[0];
  const free = new Set(['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail', 'proton']);
  const base = free.has(main.toLowerCase()) ? localPart : main;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// --- CliRow ---
// One CLI connection within a profile card.

interface CliRowProps {
  provider: AgentDefinition;
  identity?: AccountProviderIdentity;
  authStatus: CliAuthStatus | null;
  onVerify(): void;
  verifying: boolean;
  onConnect?(): void; // undefined = default profile (no connect action)
}

function CliRow({
  provider,
  identity,
  authStatus,
  onVerify,
  verifying,
  onConnect,
}: CliRowProps): React.JSX.Element {
  const effectiveStatus = authStatus ?? identity?.authStatus;
  const isOk = effectiveStatus === 'ok';
  const isCliMissing = authStatus === 'cli-not-found';
  const isNotConnected = !isOk && !isCliMissing;

  const dotColor = isCliMissing
    ? 'bg-red-400'
    : isOk
      ? 'bg-green-400'
      : 'bg-neutral-600';

  let statusText: string;
  if (isCliMissing) {
    statusText = 'CLI not found';
  } else if (isOk) {
    const id = identity?.identity;
    statusText = id ? `connected as ${id}` : 'connected';
  } else {
    statusText = 'not connected';
  }

  const statusColor = isCliMissing
    ? 'text-red-300'
    : isOk
      ? 'text-text-secondary'
      : 'text-text-muted';

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-2 flex-1 min-w-0 ${isNotConnected ? 'opacity-50' : ''}`}>
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-xs text-text-muted w-20 shrink-0">{provider.displayName}</span>
        <span className={`flex-1 min-w-0 truncate text-xs ${statusColor}`}>{statusText}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onConnect && !isOk && !isCliMissing && (
          <button
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            onClick={onConnect}
          >
            Connect
          </button>
        )}
        {isCliMissing && provider.installHelpUrl && (
          <button
            className="text-xs text-red-300 hover:text-red-200 underline transition-colors"
            onClick={() => window.open(provider.installHelpUrl, '_blank')}
          >
            Install
          </button>
        )}
        <button
          className="text-text-muted hover:text-text-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={onVerify}
          disabled={verifying}
          title="Verify connection"
          aria-label="Verify connection"
        >
          {verifying
            ? <Loader2 size={10} strokeWidth={1.5} className="animate-spin" />
            : <RotateCw size={10} strokeWidth={1.5} />}
        </button>
      </div>
    </div>
  );
}

// --- ProfileCard ---
// An isolated workspace showing its CLI connections.

interface ProfileCardProps {
  account: AccountProfileWithProviders;
  authStatuses: Record<string, CliAuthStatus>;
  verifyingId: string | null;
  deletingId: string | null;
  isNew: boolean;
  onVerify(sessionType: string): void;
  onConnect(sessionType: string): void;
  onDelete(): void;
}

function ProfileCard({
  account,
  authStatuses,
  verifyingId,
  deletingId,
  isNew,
  onVerify,
  onConnect,
  onDelete,
}: ProfileCardProps): React.JSX.Element {
  return (
    <div className={`mb-3 border rounded-md overflow-hidden ${isNew ? 'border-accent/40' : 'border-border-default'}`}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary">
        <span className="text-sm text-text-primary font-medium truncate flex-1 min-w-0">{account.name}</span>
        {account.isDefault ? (
          <span className="text-xs text-text-muted shrink-0">default · uses your system $HOME</span>
        ) : (
          <button
            className="text-text-muted hover:text-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            onClick={onDelete}
            disabled={deletingId === account.accountId}
            title="Delete profile"
            aria-label="Delete profile"
          >
            {deletingId === account.accountId
              ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
              : <Trash2 size={13} strokeWidth={1.5} />}
          </button>
        )}
      </div>
      {/* CLI rows */}
      <div className="px-3 py-2.5 space-y-2 bg-bg-primary">
        {SUPPORTED_PROVIDERS.map((provider) => {
          const key = `${account.accountId}:${provider.sessionType}`;
          return (
            <CliRow
              key={provider.sessionType}
              provider={provider}
              identity={account.providers?.[provider.sessionType]}
              authStatus={authStatuses[key] ?? null}
              onVerify={() => onVerify(provider.sessionType)}
              verifying={verifyingId === key}
              onConnect={!account.isDefault ? () => onConnect(provider.sessionType) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

// --- AccountsDialog ---

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

  // newAccountId: set when an account is just created; cleared when rename prompt fires or account deleted
  const [newAccountId, setNewAccountId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // verifyingId is `${accountId}:${sessionType}` while a manual verify call is in-flight
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // authStatuses keyed by `${accountId}:${sessionType}` for fresh check results
  const [authStatuses, setAuthStatuses] = useState<Record<string, CliAuthStatus>>({});

  // Rename prompt state (shown after any provider auth detected for a new account)
  const [renameAccountId, setRenameAccountId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Ordered: default account first, then secondaries in original order
  const orderedAccounts = [
    ...accounts.filter((a) => a.isDefault),
    ...accounts.filter((a) => !a.isDefault),
  ];

  // Helper: open a provider auth terminal and focus the new session tile
  const openAuthTerminal = async (accountId: string, sessionType: string): Promise<void> => {
    const sessionId = await window.mcode.accounts.openAuthTerminal(accountId, sessionType);
    const session = await window.mcode.sessions.get(sessionId);
    if (session) {
      addSession(session);
      addTile(session.sessionId);
      persist();
      useLayoutStore.getState().focusTile(`session:${session.sessionId}`);
    }
  };

  // Keep mutable refs current for use inside async effects without stale closures
  const openedRef = useRef(false);
  const accountsRef = useRef(accounts);
  const newAccountIdRef = useRef(newAccountId);
  const refreshRef = useRef(refresh);
  accountsRef.current = accounts;
  newAccountIdRef.current = newAccountId;
  refreshRef.current = refresh;

  // Auto-verify all accounts × providers on dialog open (background check, no per-row spinner)
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;

    void (async () => {
      const currentAccounts = accountsRef.current;
      const pairs = currentAccounts.flatMap((a) =>
        SUPPORTED_PROVIDERS.map((p) => ({ accountId: a.accountId, sessionType: p.sessionType })),
      );
      if (pairs.length === 0) return;
      const results = await Promise.allSettled(
        pairs.map((pair) => window.mcode.accounts.getAuthStatus(pair.accountId, pair.sessionType)),
      );
      const updates: Record<string, CliAuthStatus> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const key = `${pairs[i].accountId}:${pairs[i].sessionType}`;
          updates[key] = r.value.status;
          // Trigger rename prompt if this is the newly-created account's first identity
          const currentNewAccountId = newAccountIdRef.current;
          if (
            currentNewAccountId === pairs[i].accountId &&
            r.value.status === 'ok' &&
            (r.value.identity ?? r.value.email)
          ) {
            const identity = r.value.identity ?? r.value.email!;
            setRenameAccountId(pairs[i].accountId);
            setRenameName(suggestNameFromEmail(identity));
            setNewAccountId(null);
          }
        }
      });
      setAuthStatuses((prev) => ({ ...prev, ...updates }));
      await refreshRef.current();
      useAccountsStore.getState().refreshCliStatus().catch(() => {});
    })();
  }, [open]);

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

  // One-click add: create profile, then immediately background-verify all providers
  const handleAddAccount = async (): Promise<void> => {
    if (isCreating || newAccountId) return;
    setIsCreating(true);
    setError(null);
    try {
      const account = await window.mcode.accounts.create();
      setNewAccountId(account.accountId);
      await refresh();
      // Background-verify new profile's providers (catches already-authenticated edge case)
      void Promise.allSettled(
        SUPPORTED_PROVIDERS.map(async (p) => {
          const result = await window.mcode.accounts.getAuthStatus(account.accountId, p.sessionType);
          const key = `${account.accountId}:${p.sessionType}`;
          setAuthStatuses((prev) => ({ ...prev, [key]: result.status }));
          if (result.status === 'ok' && (result.identity ?? result.email)) {
            const identity = result.identity ?? result.email!;
            setRenameAccountId(account.accountId);
            setRenameName(suggestNameFromEmail(identity));
            setNewAccountId(null);
          }
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleVerify = async (accountId: string, sessionType: string): Promise<void> => {
    const key = `${accountId}:${sessionType}`;
    setVerifyingId(key);
    setError(null);
    try {
      const result = await window.mcode.accounts.getAuthStatus(accountId, sessionType);
      setAuthStatuses((prev) => ({ ...prev, [key]: result.status }));
      await refresh();
      useAccountsStore.getState().refreshCliStatus().catch(() => {});
      // Trigger rename prompt for newly-created profile on first successful auth
      if (newAccountId === accountId && result.status === 'ok' && (result.identity ?? result.email)) {
        const identity = result.identity ?? result.email!;
        setRenameAccountId(accountId);
        setRenameName(suggestNameFromEmail(identity));
        setNewAccountId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleConnect = async (accountId: string, sessionType: string): Promise<void> => {
    setError(null);
    try {
      await openAuthTerminal(accountId, sessionType);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (accountId: string): Promise<void> => {
    setDeletingId(accountId);
    setError(null);
    try {
      await window.mcode.accounts.delete(accountId);
      if (newAccountId === accountId) setNewAccountId(null);
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
      title="Profiles"
      width="w-[480px]"
      className="max-h-[80vh] overflow-y-auto"
    >
      <p className="text-xs text-text-muted mb-4 -mt-1">
        Each profile is an isolated workspace with its own credentials for each AI tool.
      </p>

      {/* Profile cards */}
      {orderedAccounts.map((account) => (
        <ProfileCard
          key={account.accountId}
          account={account}
          authStatuses={authStatuses}
          verifyingId={verifyingId}
          deletingId={deletingId}
          isNew={newAccountId === account.accountId}
          onVerify={(sessionType) => handleVerify(account.accountId, sessionType)}
          onConnect={(sessionType) => handleConnect(account.accountId, sessionType)}
          onDelete={() => handleDelete(account.accountId)}
        />
      ))}

      {/* Rename prompt (shown after any provider auth detected for a new profile) */}
      {renameAccountId && (
        <div className="mb-4 space-y-2">
          <p className="text-xs text-text-muted uppercase tracking-wide">Name your profile</p>
          <input
            ref={renameInputRef}
            className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Profile name"
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

      {/* Add profile */}
      {!renameAccountId && (
        <div className="mb-4">
          <button
            className="text-sm text-text-muted hover:text-text-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={handleAddAccount}
            disabled={isCreating || Boolean(newAccountId)}
          >
            {isCreating ? 'Creating…' : '+ Add Profile'}
          </button>
          <p className="text-xs text-text-muted mt-0.5">Creates a new isolated workspace</p>
        </div>
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

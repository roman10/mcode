import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAccountsStore } from '../stores/accounts-store';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { getAgentDefinition, AGENT_SESSION_TYPES } from '@shared/session-agents';
import type { AgentDefinition } from '@shared/session-agents';
import Dialog from './shared/Dialog';
import type { AccountProfileWithProviders, AccountProviderIdentity, CliAuthStatus } from '@shared/types';

// Providers that support account profiles — derived from agent metadata.
// Re-evaluated at module load so it updates automatically when new providers are added.
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

// --- ProviderStatusRow ---

interface ProviderStatusRowProps {
  provider: AgentDefinition;
  identity?: AccountProviderIdentity;
  authStatus: CliAuthStatus | null; // fresh check result from this session
  onVerify(): void;
  verifying: boolean;
  onLogin?(): void; // undefined for default account
}

function ProviderStatusRow({
  provider,
  identity,
  authStatus,
  onVerify,
  verifying,
  onLogin,
}: ProviderStatusRowProps): React.JSX.Element {
  // Fresh check takes priority over persisted identity status
  const effectiveStatus = authStatus ?? identity?.authStatus;
  const isOk = effectiveStatus === 'ok';
  const isCliMissing = authStatus === 'cli-not-found';

  const dotColor = isCliMissing
    ? 'bg-red-400'
    : isOk
      ? 'bg-green-400'
      : effectiveStatus != null
        ? 'bg-amber-400'
        : 'bg-neutral-500';

  const identityText = isCliMissing
    ? 'CLI not found'
    : isOk
      ? (identity?.identity ?? 'Authenticated')
      : effectiveStatus != null
        ? 'Not authenticated'
        : 'Not verified';

  const textColor = isCliMissing
    ? 'text-red-300'
    : isOk
      ? 'text-text-secondary'
      : 'text-text-muted';

  return (
    <div>
      <div className="flex items-center gap-2 text-xs pl-1">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-text-muted w-20 shrink-0">{provider.displayName}:</span>
        <span className={`flex-1 min-w-0 truncate ${textColor}`}>{identityText}</span>
        <div className="flex items-center gap-2 shrink-0">
          {onLogin && !isOk && (
            <button
              className="text-text-muted hover:text-text-secondary transition-colors"
              onClick={onLogin}
            >
              Login
            </button>
          )}
          <button
            className="text-text-muted hover:text-text-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={onVerify}
            disabled={verifying}
          >
            {verifying ? 'Checking…' : 'Verify'}
          </button>
        </div>
      </div>
      {isCliMissing && provider.installHelpUrl && (
        <div className="mt-1 ml-4 text-xs text-red-300">
          Install {provider.displayName} to get started.{' '}
          <button
            className="underline hover:text-red-200 transition-colors"
            onClick={() => window.open(provider.installHelpUrl, '_blank')}
          >
            Instructions
          </button>
        </div>
      )}
    </div>
  );
}

// --- AccountBlock ---

interface AccountBlockProps {
  account: AccountProfileWithProviders;
  authStatuses: Record<string, CliAuthStatus>;
  verifyingId: string | null;
  onVerify(sessionType: string): void;
  onLogin(sessionType: string): void;
  onDelete?(): void;
}

function AccountBlock({
  account,
  authStatuses,
  verifyingId,
  onVerify,
  onLogin,
  onDelete,
}: AccountBlockProps): React.JSX.Element {
  const key = (sessionType: string) => `${account.accountId}:${sessionType}`;

  return (
    <div className="bg-bg-primary border border-border-default rounded-md px-3 py-2.5 space-y-2">
      {/* Account header */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-primary">{account.name}</span>
        {account.isDefault && (
          <span className="text-xs text-text-muted bg-bg-secondary px-1.5 py-0.5 rounded">
            default
          </span>
        )}
        {onDelete && (
          <button
            className="ml-auto text-text-muted hover:text-red-400 transition-colors shrink-0"
            onClick={onDelete}
          >
            <Trash2 size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Per-provider status rows */}
      {SUPPORTED_PROVIDERS.map((provider) => (
        <ProviderStatusRow
          key={provider.sessionType}
          provider={provider}
          identity={account.providers?.[provider.sessionType]}
          authStatus={authStatuses[key(provider.sessionType)] ?? null}
          onVerify={() => onVerify(provider.sessionType)}
          verifying={verifyingId === key(provider.sessionType)}
          onLogin={!account.isDefault ? () => onLogin(provider.sessionType) : undefined}
        />
      ))}
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

  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // verifyingId is `${accountId}:${sessionType}` while a verify call is in-flight
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // authStatuses keyed by `${accountId}:${sessionType}` for fresh check results
  const [authStatuses, setAuthStatuses] = useState<Record<string, CliAuthStatus>>({});

  // Rename prompt state (shown after Claude auth auto-detected in "Add Account" flow)
  const [renameAccountId, setRenameAccountId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const defaultAccount = accounts.find((a) => a.isDefault);
  const secondaryAccounts = accounts.filter((a) => !a.isDefault);

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

  // One-click add: create account with placeholder name, open Claude auth terminal
  const handleAddAccount = async (): Promise<void> => {
    if (isCreating || pendingAccountId) return;
    setIsCreating(true);
    setError(null);
    try {
      const account = await window.mcode.accounts.create();
      await refresh();
      await openAuthTerminal(account.accountId, 'claude');
      setPendingAccountId(account.accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  // Auto-poll Claude auth status while a pending account exists
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!pendingAccountId) return;
    const intervalId = setInterval(async () => {
      try {
        const result = await window.mcode.accounts.getAuthStatus(pendingAccountId, 'claude');
        if (result.status === 'ok') {
          await refreshRef.current();
          setPendingAccountId(null);
          const emailOrIdentity = result.identity ?? result.email;
          if (emailOrIdentity) {
            setRenameAccountId(pendingAccountId);
            setRenameName(suggestNameFromEmail(emailOrIdentity));
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

  const handleVerify = async (accountId: string, sessionType: string): Promise<void> => {
    const key = `${accountId}:${sessionType}`;
    setVerifyingId(key);
    setError(null);
    try {
      const result = await window.mcode.accounts.getAuthStatus(accountId, sessionType);
      setAuthStatuses((prev) => ({ ...prev, [key]: result.status }));
      await refresh();
      useAccountsStore.getState().refreshCliStatus().catch(() => {});
      if (pendingAccountId === accountId && result.status === 'ok') setPendingAccountId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleLogin = async (accountId: string, sessionType: string): Promise<void> => {
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
          <AccountBlock
            account={defaultAccount}
            authStatuses={authStatuses}
            verifyingId={verifyingId}
            onVerify={(sessionType) => handleVerify(defaultAccount.accountId, sessionType)}
            onLogin={() => {
              /* default account cannot open auth terminals */
            }}
          />
        )}
      </div>

      {/* Secondary accounts */}
      {secondaryAccounts.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-2">Secondary Accounts</p>
          <div className="space-y-2">
            {secondaryAccounts.map((account) => (
              <AccountBlock
                key={account.accountId}
                account={account}
                authStatuses={authStatuses}
                verifyingId={verifyingId}
                onVerify={(sessionType) => handleVerify(account.accountId, sessionType)}
                onLogin={(sessionType) => handleLogin(account.accountId, sessionType)}
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

      {/* Rename prompt (shown after Claude auth auto-detected) */}
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

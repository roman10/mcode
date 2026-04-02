import { typedHandle } from '../ipc-helpers';
import type { AccountService } from './account-service';
import type { AccountProviderRegistry } from './account-provider';

/**
 * Register IPC handlers for account operations.
 * Provider-aware: auth/CLI/terminal calls accept an optional sessionType parameter.
 */
export function registerAccountIpc(
  accountService: AccountService,
  sessionManager: Pick<import('../session/session-manager').SessionManager, 'create'>,
  registry: AccountProviderRegistry,
): void {
  typedHandle('account:list', () => {
    return accountService.listWithProviders();
  });

  typedHandle('account:create', (name) => {
    return accountService.create(name);
  });

  typedHandle('account:rename', (accountId, name) => {
    accountService.rename(accountId, name);
  });

  typedHandle('account:delete', (accountId) => {
    accountService.delete(accountId);
  });

  typedHandle('account:get-auth-status', async (accountId, sessionType) => {
    return accountService.getAuthStatus(accountId, sessionType);
  });

  typedHandle('account:check-cli-installed', async (sessionType) => {
    return accountService.checkCliInstalled(sessionType);
  });

  typedHandle('account:open-auth-terminal', (accountId, sessionType) => {
    const account = accountService.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (account.isDefault) throw new Error('Default account uses standard auth');
    if (!account.homeDir) throw new Error('Account has no home directory');

    const type = sessionType ?? 'claude';
    const adapter = registry.get(type);
    if (!adapter) throw new Error(`No provider adapter for: ${type}`);

    const input = adapter.buildAuthTerminalInput(account);
    if (!input) throw new Error(`Provider ${type} does not support terminal-based auth`);

    const session = sessionManager.create(input);
    return session.sessionId;
  });

  typedHandle('account:get-subscription-usage', async (accountId, forceRefresh) => {
    const account = accountService.get(accountId);
    if (!account) return null;
    // Route through adapter — only Claude supports subscription usage currently
    const adapter = registry.get('claude');
    if (!adapter || !adapter.supportsSubscriptionUsage()) return null;
    return adapter.getSubscriptionUsage(account, forceRefresh);
  });
}

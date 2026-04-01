import { typedHandle } from '../ipc-helpers';
import { fetchSubscriptionUsage } from '../claude-subscription-fetcher';
import type { AccountService } from './account-service';

/**
 * Register IPC handlers for account operations.
 * All channel names and behavior are identical to the original registerAccountIpc.
 */
export function registerAccountIpc(
  accountService: AccountService,
  sessionManager: Pick<import('../session/session-manager').SessionManager, 'create'>,
): void {
  typedHandle('account:list', () => {
    return accountService.list();
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

  typedHandle('account:get-auth-status', async (accountId) => {
    const result = await accountService.getAuthStatus(accountId);
    if (result.email) {
      accountService.setEmail(accountId, result.email);
    }
    return result;
  });

  typedHandle('account:check-cli-installed', async () => {
    return accountService.checkCliInstalled();
  });

  typedHandle('account:open-auth-terminal', (accountId) => {
    const account = accountService.get(accountId);
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (account.isDefault) throw new Error('Default account uses standard auth');
    if (!account.homeDir) throw new Error('Account has no home directory');

    const session = sessionManager.create(
      { cwd: account.homeDir, label: `Auth: ${account.name}`, sessionType: 'terminal', accountId, initialCommand: 'claude auth login' },
    );
    return session.sessionId;
  });

  typedHandle('account:get-subscription-usage', async (accountId, forceRefresh) => {
    const account = accountService.get(accountId);
    if (!account) return null;
    return fetchSubscriptionUsage(account, forceRefresh);
  });
}

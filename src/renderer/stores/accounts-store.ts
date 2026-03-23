import { create } from 'zustand';
import type { AccountProfile, CliAuthStatus, SubscriptionUsage } from '@shared/types';

interface AccountsState {
  accounts: AccountProfile[];
  /** Overall CLI/auth status for the default account. Checked on startup. */
  cliStatus: CliAuthStatus | null;
  /** Whether the CLI status banner has been dismissed this session. */
  cliStatusDismissed: boolean;
  subscriptionByAccount: Record<string, SubscriptionUsage | null>;
  refresh(): Promise<void>;
  refreshCliStatus(): Promise<void>;
  dismissCliStatus(): void;
  refreshSubscriptionUsage(): Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  cliStatus: null,
  cliStatusDismissed: false,
  subscriptionByAccount: {},

  refresh: async () => {
    const accounts = await window.mcode.accounts.list();
    set({ accounts });
  },

  refreshCliStatus: async () => {
    try {
      const status = await window.mcode.accounts.checkCliInstalled();
      set({ cliStatus: status });
    } catch {
      // If the IPC call itself fails, leave as null (unknown)
    }
  },

  dismissCliStatus: () => {
    set({ cliStatusDismissed: true });
  },

  refreshSubscriptionUsage: async () => {
    let { accounts } = get();
    if (accounts.length === 0) {
      await get().refresh();
      accounts = get().accounts;
    }
    const entries = await Promise.all(
      accounts.map(async (a) => {
        // Invalidate cache so manual refresh always fetches fresh data
        await window.mcode.accounts.invalidateSubscriptionCache(a.accountId);
        const usage = await window.mcode.accounts.getSubscriptionUsage(a.accountId);
        return [a.accountId, usage] as const;
      }),
    );
    set({ subscriptionByAccount: Object.fromEntries(entries) });
  },
}));

import { create } from 'zustand';
import type { AccountProfile, SubscriptionUsage } from '../../shared/types';

interface AccountsState {
  accounts: AccountProfile[];
  subscriptionByAccount: Record<string, SubscriptionUsage | null>;
  refresh(): Promise<void>;
  refreshSubscriptionUsage(): Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  subscriptionByAccount: {},

  refresh: async () => {
    const accounts = await window.mcode.accounts.list();
    set({ accounts });
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

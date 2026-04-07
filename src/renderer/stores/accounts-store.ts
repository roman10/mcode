import { create } from 'zustand';
import type { AccountProfileWithProviders, CliAuthStatus } from '@shared/types';

interface AccountsState {
  accounts: AccountProfileWithProviders[];
  /** Overall CLI/auth status for the default account. Checked on startup. */
  cliStatus: CliAuthStatus | null;
  /** Whether the CLI status banner has been dismissed this session. */
  cliStatusDismissed: boolean;
  refresh(): Promise<void>;
  refreshCliStatus(): Promise<void>;
  dismissCliStatus(): void;
}

export const useAccountsStore = create<AccountsState>((set) => ({
  accounts: [],
  cliStatus: null,
  cliStatusDismissed: false,

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
}));

import { create } from 'zustand';
import type { AccountProfile } from '../../shared/types';

interface AccountsState {
  accounts: AccountProfile[];
  refresh(): Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set) => ({
  accounts: [],
  refresh: async () => {
    const accounts = await window.mcode.accounts.list();
    set({ accounts });
  },
}));

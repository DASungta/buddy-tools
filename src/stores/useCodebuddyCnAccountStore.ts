import { create } from 'zustand';
import type { CodebuddyCnAccount } from '../types/codebuddyCn';
import * as cnService from '../services/codebuddyCnService';

const CURRENT_ACCOUNT_KEY = 'agtools.codebuddy_cn.current_account_id';

function loadCurrentAccountId(): string | null {
  try {
    return localStorage.getItem(CURRENT_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function saveCurrentAccountId(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(CURRENT_ACCOUNT_KEY);
    } else {
      localStorage.setItem(CURRENT_ACCOUNT_KEY, id);
    }
  } catch {
    // ignore
  }
}

interface CodebuddyCnAccountState {
  accounts: CodebuddyCnAccount[];
  currentAccountId: string | null;
  loading: boolean;
  error: string | null;

  fetchAccounts: () => Promise<void>;
  addAccountWithToken: (accessToken: string) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  deleteAccounts: (ids: string[]) => Promise<void>;
  refreshToken: (id: string) => Promise<void>;
  refreshAllTokens: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  updateTags: (id: string, tags: string[]) => Promise<void>;
  importJson: (json: string) => Promise<void>;
  exportAccounts: (ids: string[]) => Promise<string>;
  checkin: (id: string) => Promise<void>;
}

export const useCodebuddyCnAccountStore = create<CodebuddyCnAccountState>((set, get) => ({
  accounts: [],
  currentAccountId: loadCurrentAccountId(),
  loading: false,
  error: null,

  fetchAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await cnService.listCodebuddyCnAccounts();
      set({ accounts, loading: false });
    } catch (error) {
      console.error('[CodebuddyCnStore] fetchAccounts failed:', error);
      set({ error: String(error), loading: false });
    }
  },

  addAccountWithToken: async (accessToken: string) => {
    set({ loading: true, error: null });
    try {
      await cnService.addCodebuddyCnAccountWithToken(accessToken);
      await get().fetchAccounts();
      set({ loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  deleteAccount: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await cnService.deleteCodebuddyCnAccount(id);
      await get().fetchAccounts();
      set({ loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  deleteAccounts: async (ids: string[]) => {
    set({ loading: true, error: null });
    try {
      await cnService.deleteCodebuddyCnAccounts(ids);
      await get().fetchAccounts();
      set({ loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  refreshToken: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const updated = await cnService.refreshCodebuddyCnToken(id);
      const { accounts } = get();
      const updatedAccounts = accounts.map((acc) => (acc.id === id ? { ...acc, ...updated } : acc));
      set({ accounts: updatedAccounts, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  refreshAllTokens: async () => {
    set({ loading: true, error: null });
    try {
      await cnService.refreshAllCodebuddyCnTokens();
      await get().fetchAccounts();
      set({ loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  switchAccount: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await cnService.setCurrentCodebuddyCnAccount(id);
      saveCurrentAccountId(id);
      set({ currentAccountId: id, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  updateTags: async (id: string, tags: string[]) => {
    try {
      await cnService.updateCodebuddyCnAccountTags(id, tags);
      const { accounts } = get();
      const updatedAccounts = accounts.map((acc) => (acc.id === id ? { ...acc, tags } : acc));
      set({ accounts: updatedAccounts });
    } catch (error) {
      console.error('[CodebuddyCnStore] updateTags failed:', error);
      throw error;
    }
  },

  importJson: async (json: string) => {
    set({ loading: true, error: null });
    try {
      await cnService.importCodebuddyCnFromJson(json);
      await get().fetchAccounts();
      set({ loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },

  exportAccounts: async (ids: string[]) => {
    try {
      return await cnService.exportCodebuddyCnAccounts(ids);
    } catch (error) {
      console.error('[CodebuddyCnStore] exportAccounts failed:', error);
      throw error;
    }
  },

  checkin: async (id: string) => {
    try {
      await cnService.checkinCodebuddyCn(id);
      await get().fetchAccounts();
    } catch (error) {
      console.error('[CodebuddyCnStore] checkin failed:', error);
      throw error;
    }
  },
}));

import { create } from 'zustand';
import type {
  CodebuddyInstance,
  CreateInstanceParams,
  InstanceDefaults,
  UpdateInstanceParams,
} from '../types/codebuddyInstance';
import * as svc from '../services/codebuddyCnInstanceService';

interface CodebuddyCnInstanceState {
  instances: CodebuddyInstance[];
  defaults: InstanceDefaults | null;
  loading: boolean;
  error: string | null;

  fetchInstances: () => Promise<void>;
  fetchDefaults: () => Promise<void>;
  createInstance: (params: CreateInstanceParams) => Promise<void>;
  updateInstance: (params: UpdateInstanceParams) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  startInstance: (id: string) => Promise<void>;
  stopInstance: (id: string) => Promise<void>;
  focusInstance: (id: string) => Promise<void>;
  injectToken: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
}

export const useCodebuddyCnInstanceStore = create<CodebuddyCnInstanceState>((set, get) => ({
  instances: [],
  defaults: null,
  loading: false,
  error: null,

  fetchInstances: async () => {
    set({ loading: true, error: null });
    try {
      const instances = await svc.listCodebuddyCnInstances();
      set({ instances, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchDefaults: async () => {
    try {
      const defaults = await svc.getCodebuddyCnInstanceDefaults();
      set({ defaults });
    } catch (e) {
      console.error('[CnInstanceStore] fetchDefaults failed:', e);
    }
  },

  createInstance: async (params) => {
    set({ loading: true, error: null });
    try {
      await svc.createCodebuddyCnInstance(params);
      await get().fetchInstances();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  updateInstance: async (params) => {
    set({ loading: true, error: null });
    try {
      await svc.updateCodebuddyCnInstance(params);
      await get().fetchInstances();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  deleteInstance: async (id) => {
    set({ loading: true, error: null });
    try {
      await svc.deleteCodebuddyCnInstance(id);
      await get().fetchInstances();
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  startInstance: async (id) => {
    try {
      await svc.startCodebuddyCnInstance(id);
      await get().fetchInstances();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  stopInstance: async (id) => {
    try {
      await svc.stopCodebuddyCnInstance(id);
      await get().fetchInstances();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  focusInstance: async (id) => {
    try {
      await svc.focusCodebuddyCnInstance(id);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  injectToken: async (id) => {
    try {
      await svc.injectTokenForCodebuddyCnInstance(id);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  stopAll: async () => {
    const { instances } = get();
    const running = instances.filter((i) => i.running);
    await Promise.allSettled(running.map((i) => svc.stopCodebuddyCnInstance(i.id)));
    await get().fetchInstances();
  },
}));

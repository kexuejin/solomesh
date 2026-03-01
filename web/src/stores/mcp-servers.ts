import { create } from 'zustand';
import { api } from '../api/client';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export interface McpServer {
  id: string;
  // stdio type
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http/sse type
  type?: 'http' | 'sse';
  url?: string;
  headers?: Record<string, string>;
  // metadata
  enabled: boolean;
  syncedFromHost?: boolean;
  description?: string;
  addedAt: string;
}

interface SyncHostResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
}

interface McpServersState {
  servers: McpServer[];
  loading: boolean;
  error: string | null;
  syncing: boolean;

  loadServers: () => Promise<void>;
  addServer: (server: {
    id: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: 'http' | 'sse';
    url?: string;
    headers?: Record<string, string>;
    description?: string;
  }) => Promise<void>;
  updateServer: (id: string, updates: Partial<McpServer>) => Promise<void>;
  toggleServer: (id: string, enabled: boolean) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  syncHostServers: () => Promise<SyncHostResult>;
}

type McpServersStoreMessageKey =
  | 'mcp.store.loadFailed'
  | 'mcp.store.addFailed'
  | 'mcp.store.updateFailed'
  | 'mcp.store.toggleFailed'
  | 'mcp.store.deleteFailed'
  | 'mcp.store.syncFailed';

function getStoreMessage(key: McpServersStoreMessageKey): string {
  return translateLocaleMessage(key);
}

export const useMcpServersStore = create<McpServersState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,
  syncing: false,

  loadServers: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ servers: McpServer[] }>('/api/mcp-servers');
      set({ servers: data.servers, loading: false, error: null });
    } catch (err) {
      set({
        loading: false,
        error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.loadFailed'),
      });
    }
  },

  addServer: async (server) => {
    try {
      await api.post('/api/mcp-servers', server);
      set({ error: null });
      await get().loadServers();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.addFailed') });
      throw err;
    }
  },

  updateServer: async (id, updates) => {
    try {
      await api.patch(`/api/mcp-servers/${encodeURIComponent(id)}`, updates);
      set({ error: null });
      await get().loadServers();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.updateFailed') });
      throw err;
    }
  },

  toggleServer: async (id, enabled) => {
    try {
      await api.patch(`/api/mcp-servers/${encodeURIComponent(id)}`, { enabled });
      set({ error: null });
      await get().loadServers();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.toggleFailed') });
    }
  },

  deleteServer: async (id) => {
    try {
      await api.delete(`/api/mcp-servers/${encodeURIComponent(id)}`);
      set({ error: null });
      await get().loadServers();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.deleteFailed') });
      throw err;
    }
  },

  syncHostServers: async () => {
    set({ syncing: true, error: null });
    try {
      const result = await api.post<SyncHostResult>('/api/mcp-servers/sync-host', {});
      await get().loadServers();
      return result;
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('mcp.store.syncFailed') });
      throw err;
    } finally {
      set({ syncing: false });
    }
  },
}));

import { create } from 'zustand';
import { api } from '../api/client';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'project';
  enabled: boolean;
  syncedFromHost?: boolean;
  userInvocable: boolean;
  allowedTools: string[];
  argumentHint: string | null;
  updatedAt: string;
  files: Array<{ name: string; type: 'file' | 'directory'; size: number }>;
}

export interface SkillDetail extends Skill {
  content: string;
}

export interface SearchResult {
  package: string;
  url: string;
  installs?: string;
}

export interface SearchResultDetail {
  description: string;
  installs: string;
  age: string;
  features: string[];
}

interface SyncHostResult {
  stats: { added: number; updated: number; deleted: number; skipped: number };
  total: number;
}

interface SkillsState {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  installing: boolean;
  syncing: boolean;
  searching: boolean;
  searchResults: SearchResult[];
  searchDetails: Record<string, SearchResultDetail | null>;
  searchDetailLoading: Record<string, boolean>;

  loadSkills: () => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  installSkill: (pkg: string) => Promise<void>;
  syncHostSkills: () => Promise<SyncHostResult>;
  getSkillDetail: (id: string) => Promise<SkillDetail>;
  searchSkills: (query: string) => Promise<void>;
  fetchSearchDetail: (url: string) => Promise<void>;
}

type SkillsStoreMessageKey =
  | 'skills.store.loadFailed'
  | 'skills.store.toggleFailed'
  | 'skills.store.deleteFailed'
  | 'skills.store.installFailed'
  | 'skills.store.syncFailed';

function getStoreMessage(key: SkillsStoreMessageKey): string {
  return translateLocaleMessage(key);
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,
  installing: false,
  syncing: false,
  searching: false,
  searchResults: [],
  searchDetails: {},
  searchDetailLoading: {},

  loadSkills: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ skills: Skill[] }>('/api/skills');
      set({ skills: data.skills, loading: false, error: null });
    } catch (err) {
      set({
        loading: false,
        error: extractStoreErrorMessage(err) ?? getStoreMessage('skills.store.loadFailed'),
      });
    }
  },

  toggleSkill: async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/api/skills/${id}`, { enabled });
      set({ error: null });
      await get().loadSkills();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('skills.store.toggleFailed') });
    }
  },

  deleteSkill: async (id: string) => {
    try {
      await api.delete(`/api/skills/${id}`);
      set({ error: null });
      await get().loadSkills();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('skills.store.deleteFailed') });
      throw err;
    }
  },

  installSkill: async (pkg: string) => {
    set({ installing: true, error: null });
    try {
      await api.post('/api/skills/install', { package: pkg }, 60_000);
      await get().loadSkills();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('skills.store.installFailed') });
      throw err;
    } finally {
      set({ installing: false });
    }
  },

  syncHostSkills: async () => {
    set({ syncing: true, error: null });
    try {
      const result = await api.post<SyncHostResult>('/api/skills/sync-host', {});
      await get().loadSkills();
      return result;
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('skills.store.syncFailed') });
      throw err;
    } finally {
      set({ syncing: false });
    }
  },

  getSkillDetail: async (id: string) => {
    const data = await api.get<{ skill: SkillDetail }>(`/api/skills/${id}`);
    return data.skill;
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchResults: [], searchDetails: {}, searchDetailLoading: {} });
    try {
      const data = await api.get<{ results: SearchResult[] }>(
        `/api/skills/search?q=${encodeURIComponent(query)}`,
      );
      set({ searching: false, searchResults: data.results });
    } catch (err) {
      set({ searching: false, searchResults: [] });
    }
  },

  fetchSearchDetail: async (url: string) => {
    const { searchDetails, searchDetailLoading } = get();
    // Already fetched or in-flight
    if (url in searchDetails || searchDetailLoading[url]) return;

    set({ searchDetailLoading: { ...get().searchDetailLoading, [url]: true } });
    try {
      const data = await api.get<{ detail: SearchResultDetail | null }>(
        `/api/skills/search/detail?url=${encodeURIComponent(url)}`,
      );
      set({
        searchDetails: { ...get().searchDetails, [url]: data.detail },
        searchDetailLoading: { ...get().searchDetailLoading, [url]: false },
      });
    } catch {
      set({
        searchDetails: { ...get().searchDetails, [url]: null },
        searchDetailLoading: { ...get().searchDetailLoading, [url]: false },
      });
    }
  },
}));

import { create } from 'zustand';

import { api } from '../api/client';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export type DecisionItemStatus = 'pending' | 'accepted' | 'ignored';
export type DecisionItemScopeLevel = 'global' | 'workspace';
export type DecisionItemSourceType = 'manual' | 'automation' | 'plugin' | 'workflow';
export type DecisionItemPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DecisionItem {
  id: string;
  title: string;
  summary: string | null;
  status: DecisionItemStatus;
  scope_level: DecisionItemScopeLevel;
  scope_id: string | null;
  priority: DecisionItemPriority | null;
  source_type: DecisionItemSourceType;
  source_id: string;
  source_run_id: string | null;
  evidence: string | null;
  suggested_todo_title: string | null;
  suggested_todo_description: string | null;
  suggested_todo_priority: DecisionItemPriority | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  decided_by: string | null;
  accepted_todo_id: string | null;
}

export interface DecisionItemFilters {
  status?: DecisionItemStatus;
  scope_level?: DecisionItemScopeLevel;
  scope_id?: string;
  source_type?: DecisionItemSourceType;
  source_id?: string;
  cursor?: string;
  limit?: number;
}

interface DecisionItemsStore {
  items: DecisionItem[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  loadItems: (filters?: DecisionItemFilters) => Promise<void>;
  acceptItem: (id: string) => Promise<boolean>;
  ignoreItem: (id: string) => Promise<boolean>;
}

type DecisionItemsStoreMessageKey =
  | 'decisionCenter.store.loadFailed'
  | 'decisionCenter.store.acceptFailed'
  | 'decisionCenter.store.ignoreFailed';

function getStoreMessage(key: DecisionItemsStoreMessageKey): string {
  return translateLocaleMessage(key);
}

function buildQuery(filters: DecisionItemFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.scope_level) params.set('scope_level', filters.scope_level);
  if (filters.scope_id) params.set('scope_id', filters.scope_id);
  if (filters.source_type) params.set('source_type', filters.source_type);
  if (filters.source_id) params.set('source_id', filters.source_id);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export const useDecisionItemsStore = create<DecisionItemsStore>((set) => ({
  items: [],
  nextCursor: null,
  loading: false,
  error: null,

  loadItems: async (filters) => {
    set({ loading: true });
    try {
      const data = await api.get<{ items: DecisionItem[]; nextCursor: string | null }>(
        `/api/decision-items${buildQuery(filters)}`,
      );
      set({
        items: data.items,
        nextCursor: data.nextCursor,
        loading: false,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        error: extractStoreErrorMessage(error) ?? getStoreMessage('decisionCenter.store.loadFailed'),
      });
    }
  },

  acceptItem: async (id) => {
    try {
      const data = await api.post<{
        ok: true;
        decision_item_id: string;
        status: 'accepted';
        todo: { todo_id: string };
      }>(`/api/decision-items/${id}/accept`, {});
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'accepted',
                decided_at: new Date().toISOString(),
                accepted_todo_id: data.todo.todo_id,
              }
            : item,
        ),
        error: null,
      }));
      return true;
    } catch (error) {
      set({
        error: extractStoreErrorMessage(error) ?? getStoreMessage('decisionCenter.store.acceptFailed'),
      });
      return false;
    }
  },

  ignoreItem: async (id) => {
    try {
      await api.post(`/api/decision-items/${id}/ignore`, {});
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'ignored',
                decided_at: new Date().toISOString(),
              }
            : item,
        ),
        error: null,
      }));
      return true;
    } catch (error) {
      set({
        error: extractStoreErrorMessage(error) ?? getStoreMessage('decisionCenter.store.ignoreFailed'),
      });
      return false;
    }
  },
}));

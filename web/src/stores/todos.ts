import { create } from 'zustand';

import { api } from '../api/client';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export type TodoPriority = 'low' | 'medium' | 'high' | 'critical';
export type TodoStatus = 'open' | 'in_progress' | 'done' | 'archived';
export type TodoSourceType = 'manual' | 'automation' | 'plugin' | 'workflow';
export type TodoTriggerMode = 'manual' | 'automation';
export type TodoIngestAction = 'created' | 'merged' | 'ignored';

export interface TodoItem {
  id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority | null;
  dedupe_key: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoSourceEvent {
  id?: number;
  todo_id: string;
  source_type: TodoSourceType;
  source_id: string;
  source_run_id: string | null;
  trigger_mode: TodoTriggerMode | null;
  action: TodoIngestAction;
  evidence: string | null;
  created_at: string;
}

export interface TodoFilters {
  status?: TodoStatus;
  priority?: TodoPriority;
  source_type?: TodoSourceType;
  source_id?: string;
  source_run_id?: string;
  trigger_mode?: TodoTriggerMode;
  cursor?: string;
  limit?: number;
}

interface TodosStore {
  todos: TodoItem[];
  nextCursor: string | null;
  loading: boolean;
  listError: string | null;
  eventsByTodo: Record<string, TodoSourceEvent[]>;
  eventsLoadingByTodo: Record<string, boolean>;
  eventsErrorByTodo: Record<string, string | null>;
  loadTodos: (
    filters?: TodoFilters,
    options?: { append?: boolean },
  ) => Promise<void>;
  loadTodoEvents: (todoId: string) => Promise<void>;
}

type TodosStoreMessageKey =
  | 'todos.store.loadFailed'
  | 'todos.store.loadEventsFailed';

function getStoreMessage(key: TodosStoreMessageKey): string {
  return translateLocaleMessage(key);
}

function buildQuery(filters: TodoFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.source_type) params.set('source_type', filters.source_type);
  if (filters.source_id) params.set('source_id', filters.source_id);
  if (filters.source_run_id) params.set('source_run_id', filters.source_run_id);
  if (filters.trigger_mode) params.set('trigger_mode', filters.trigger_mode);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export const useTodosStore = create<TodosStore>((set) => ({
  todos: [],
  nextCursor: null,
  loading: false,
  listError: null,
  eventsByTodo: {},
  eventsLoadingByTodo: {},
  eventsErrorByTodo: {},

  loadTodos: async (filters, options) => {
    set({ loading: true });
    try {
      const data = await api.get<{ todos: TodoItem[]; nextCursor: string | null }>(
        `/api/todos${buildQuery(filters)}`,
      );
      set((state) => {
        if (!options?.append) {
          return {
            todos: data.todos,
            nextCursor: data.nextCursor,
            loading: false,
            listError: null,
          };
        }

        const existingIds = new Set(state.todos.map((todo) => todo.id));
        const merged = [...state.todos];
        for (const todo of data.todos) {
          if (existingIds.has(todo.id)) continue;
          merged.push(todo);
          existingIds.add(todo.id);
        }
        return {
          todos: merged,
          nextCursor: data.nextCursor,
          loading: false,
          listError: null,
        };
      });
    } catch (error) {
      set({
        loading: false,
        listError: extractStoreErrorMessage(error) ?? getStoreMessage('todos.store.loadFailed'),
      });
    }
  },

  loadTodoEvents: async (todoId) => {
    if (!todoId) return;
    set((state) => ({
      eventsLoadingByTodo: {
        ...state.eventsLoadingByTodo,
        [todoId]: true,
      },
      eventsErrorByTodo: {
        ...state.eventsErrorByTodo,
        [todoId]: null,
      },
    }));
    try {
      const data = await api.get<{ events: TodoSourceEvent[] }>(
        `/api/todos/${encodeURIComponent(todoId)}/events`,
      );
      set((state) => ({
        eventsByTodo: {
          ...state.eventsByTodo,
          [todoId]: data.events,
        },
        eventsLoadingByTodo: {
          ...state.eventsLoadingByTodo,
          [todoId]: false,
        },
        eventsErrorByTodo: {
          ...state.eventsErrorByTodo,
          [todoId]: null,
        },
      }));
    } catch (error) {
      set((state) => ({
        eventsLoadingByTodo: {
          ...state.eventsLoadingByTodo,
          [todoId]: false,
        },
        eventsErrorByTodo: {
          ...state.eventsErrorByTodo,
          [todoId]: extractStoreErrorMessage(error) ?? getStoreMessage('todos.store.loadEventsFailed'),
        },
      }));
    }
  },
}));

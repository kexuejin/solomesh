import { create } from 'zustand';
import { api } from '../api/client';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  operation_permission_mode?: 'default' | 'bypass';
  agent_runtime_override?: 'claude' | 'codex' | 'gemini' | null;
  execution_environment?: 'local' | 'worktree';
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  execution_type?: 'agent' | 'script';
  script_command?: string | null;
  skill_refs?: string[];
  task_config?: TaskConfig | null;
  task_state?: TaskState | null;
  next_run: string | null;
  last_run?: string | null;
  last_result?: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskConfig {
  on_error?: {
    todo_ingest?: boolean;
    [key: string]: unknown;
  };
  on_success?: {
    decision_ingest?: boolean;
    [key: string]: unknown;
  };
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TaskState {
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TaskRunLog {
  id: number;
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result?: string | null;
  error?: string | null;
}

interface TasksState {
  tasks: ScheduledTask[];
  logs: Record<string, TaskRunLog[]>;
  loading: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  createTask: (
    groupFolder: string,
    chatJid: string,
    prompt: string,
    scheduleType: 'cron' | 'interval' | 'once',
    scheduleValue: string,
    contextMode: 'group' | 'isolated',
    operationPermissionMode?: 'default' | 'bypass',
    agentRuntimeOverride?: 'claude' | 'codex' | 'gemini' | null,
    executionEnvironment?: 'local' | 'worktree',
    executionType?: 'agent' | 'script',
    scriptCommand?: string,
    taskConfig?: TaskConfig | null,
  ) => Promise<void>;
  updateTaskStatus: (id: string, status: 'active' | 'paused') => Promise<void>;
  updateTaskConfig: (
    id: string,
    taskConfig: TaskConfig | null,
  ) => Promise<void>;
  updateTaskOnErrorTodoRule: (id: string, enabled: boolean) => Promise<void>;
  updateTaskOnSuccessDecisionRule: (id: string, enabled: boolean) => Promise<void>;
  runTaskNow: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  loadLogs: (taskId: string) => Promise<void>;
}

type TasksStoreMessageKey =
  | 'tasks.store.loadFailed'
  | 'tasks.store.createFailed'
  | 'tasks.store.updateStatusFailed'
  | 'tasks.store.updateRuleFailed'
  | 'tasks.store.runNowFailed'
  | 'tasks.store.deleteFailed'
  | 'tasks.store.loadLogsFailed';

function getStoreMessage(key: TasksStoreMessageKey): string {
  return translateLocaleMessage(key);
}

function normalizeOnceScheduleValue(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return new Date(parsed).toISOString();
  }
  return new Date(trimmed).toISOString();
}

function hasOwnKeys(value: object | null | undefined): boolean {
  if (!value) return false;
  return Object.keys(value).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTaskConfig(
  config: TaskConfig | null | undefined,
): TaskConfig | null {
  if (!config || !isPlainObject(config)) return null;

  const normalized: TaskConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  if (config.on_error?.todo_ingest === true) {
    const currentOnError = isPlainObject(normalized.on_error)
      ? normalized.on_error
      : {};
    normalized.on_error = {
      ...currentOnError,
      todo_ingest: true,
    };
  } else if (isPlainObject(normalized.on_error)) {
    const nextOnError = { ...normalized.on_error };
    delete nextOnError.todo_ingest;
    if (hasOwnKeys(nextOnError)) {
      normalized.on_error = nextOnError;
    } else {
      delete normalized.on_error;
    }
  }

  if (config.on_success?.decision_ingest === true) {
    const currentOnSuccess = isPlainObject(normalized.on_success)
      ? normalized.on_success
      : {};
    normalized.on_success = {
      ...currentOnSuccess,
      decision_ingest: true,
    };
  } else if (isPlainObject(normalized.on_success)) {
    const nextOnSuccess = { ...normalized.on_success };
    delete nextOnSuccess.decision_ingest;
    if (hasOwnKeys(nextOnSuccess)) {
      normalized.on_success = nextOnSuccess;
    } else {
      delete normalized.on_success;
    }
  }

  return hasOwnKeys(normalized) ? normalized : null;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  logs: {},
  loading: false,
  error: null,

  loadTasks: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ tasks: ScheduledTask[] }>('/api/tasks');
      set({ tasks: data.tasks, loading: false, error: null });
    } catch (err) {
      set({
        loading: false,
        error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.loadFailed'),
      });
    }
  },

  createTask: async (
    groupFolder: string,
    chatJid: string,
    prompt: string,
    scheduleType: 'cron' | 'interval' | 'once',
    scheduleValue: string,
    contextMode: 'group' | 'isolated',
    operationPermissionMode?: 'default' | 'bypass',
    agentRuntimeOverride?: 'claude' | 'codex' | 'gemini' | null,
    executionEnvironment?: 'local' | 'worktree',
    executionType?: 'agent' | 'script',
    scriptCommand?: string,
    taskConfig?: TaskConfig | null,
  ) => {
    try {
      const normalizedScheduleValue =
        scheduleType === 'once'
          ? normalizeOnceScheduleValue(scheduleValue)
          : scheduleValue.trim();

      const body: Record<string, unknown> = {
        group_folder: groupFolder,
        chat_jid: chatJid,
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        schedule_value: normalizedScheduleValue,
        context_mode: contextMode,
        operation_permission_mode: operationPermissionMode || 'default',
        agent_runtime_override: agentRuntimeOverride ?? null,
        execution_environment: executionEnvironment || 'local',
      };
      if (executionType) {
        body.execution_type = executionType;
      }
      if (scriptCommand) {
        body.script_command = scriptCommand;
      }
      if (taskConfig !== undefined) {
        body.task_config = normalizeTaskConfig(taskConfig);
      }
      await api.post('/api/tasks', body);
      set({ error: null });
      await get().loadTasks();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.createFailed') });
    }
  },

  updateTaskStatus: async (id: string, status: 'active' | 'paused') => {
    try {
      await api.patch(`/api/tasks/${id}`, { status });
      set({ error: null });
      await get().loadTasks();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.updateStatusFailed') });
    }
  },

  updateTaskConfig: async (id: string, taskConfig: TaskConfig | null) => {
    try {
      await api.patch(`/api/tasks/${id}`, {
        task_config: normalizeTaskConfig(taskConfig),
      });
      set({ error: null });
      await get().loadTasks();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.updateRuleFailed') });
    }
  },

  updateTaskOnErrorTodoRule: async (id: string, enabled: boolean) => {
    const task = get().tasks.find((item) => item.id === id);
    const current = task?.task_config ?? null;
    const next = normalizeTaskConfig({
      ...(current ?? {}),
      on_error: enabled
        ? { todo_ingest: true }
        : undefined,
    });

    try {
      await get().updateTaskConfig(id, next);
    } catch {
      set({ error: getStoreMessage('tasks.store.updateRuleFailed') });
    }
  },

  updateTaskOnSuccessDecisionRule: async (id: string, enabled: boolean) => {
    const task = get().tasks.find((item) => item.id === id);
    const current = task?.task_config ?? null;
    const next = normalizeTaskConfig({
      ...(current ?? {}),
      on_success: enabled
        ? { decision_ingest: true }
        : undefined,
    });

    try {
      await get().updateTaskConfig(id, next);
    } catch {
      set({ error: getStoreMessage('tasks.store.updateRuleFailed') });
    }
  },

  runTaskNow: async (id: string) => {
    try {
      await api.post(`/api/tasks/${id}/run-now`, {});
      set({ error: null });
      await get().loadTasks();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.runNowFailed') });
    }
  },

  deleteTask: async (id: string) => {
    try {
      await api.delete(`/api/tasks/${id}`);
      set({ error: null });
      await get().loadTasks();
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.deleteFailed') });
    }
  },

  loadLogs: async (taskId: string) => {
    try {
      const data = await api.get<{ logs: TaskRunLog[] }>(`/api/tasks/${taskId}/logs`);
      set((s) => ({
        logs: { ...s.logs, [taskId]: data.logs },
        error: null,
      }));
    } catch (err) {
      set({ error: extractStoreErrorMessage(err) ?? getStoreMessage('tasks.store.loadLogsFailed') });
    }
  },
}));

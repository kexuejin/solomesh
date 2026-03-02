import { createHash, randomUUID } from 'node:crypto';

import {
  getTodoByDedupeKey,
  insertTodo,
  insertTodoSourceEvent,
  updateTodoMerge,
  withTransaction,
} from './db.js';
import type {
  Todo,
  TodoIngestAction,
  TodoPriority,
  TodoSourceType,
  TodoTriggerMode,
} from './types.js';

const TODO_PRIORITY_ORDER: TodoPriority[] = ['low', 'medium', 'high', 'critical'];

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function serializeEvidence(input: TodoIngestInput): string | null {
  if (input.evidence === undefined && input.metadata === undefined) return null;
  try {
    return JSON.stringify({
      evidence: input.evidence,
      metadata: input.metadata,
    });
  } catch {
    return JSON.stringify({
      evidence: String(input.evidence ?? ''),
      metadata: null,
    });
  }
}

function isUniqueDedupeConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed:\s*todos\.dedupe_key/i.test(error.message);
}

export interface TodoDedupeInput {
  title: string;
  description?: string;
  dedupe_key?: string;
  source_type: string;
  source_id: string;
}

export interface TodoMergePatch {
  occurrence_count: number;
  last_seen_at: string;
  priority: TodoPriority | null;
  updated_at: string;
}

export interface TodoIngestInput extends TodoDedupeInput {
  priority?: TodoPriority;
  source_type: TodoSourceType;
  source_id: string;
  source_run_id?: string;
  trigger_mode?: TodoTriggerMode;
  evidence?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TodoIngestResult {
  action: TodoIngestAction;
  todo_id: string;
  dedupe_key: string;
  reason?: string;
}

export interface AutomationTodoPolicyInput {
  autoCreate: boolean;
  dailyQuota: number;
  currentCount: number;
  hasError: boolean;
}

export function computeDedupeKey(input: TodoDedupeInput): string {
  if (input.dedupe_key?.trim()) {
    return input.dedupe_key.trim();
  }

  const normalized = [
    normalizeText(input.title),
    normalizeText(input.description),
  ].join('|');

  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function mergePriority(
  existing: TodoPriority | null,
  incoming?: TodoPriority,
): TodoPriority | null {
  if (!incoming) return existing;
  if (!existing) return incoming;
  return TODO_PRIORITY_ORDER.indexOf(incoming) > TODO_PRIORITY_ORDER.indexOf(existing)
    ? incoming
    : existing;
}

export function buildMergePatch(
  existing: Pick<Todo, 'occurrence_count' | 'priority'>,
  incoming: Pick<Todo, 'priority'> | { priority?: TodoPriority },
  nowIso: string,
): TodoMergePatch {
  return {
    occurrence_count: existing.occurrence_count + 1,
    last_seen_at: nowIso,
    priority: mergePriority(existing.priority, incoming.priority ?? undefined),
    updated_at: nowIso,
  };
}

export function shouldIngestAutomationTodo(
  input: AutomationTodoPolicyInput,
): boolean {
  if (!input.autoCreate) return false;
  if (!input.hasError) return false;
  if (input.dailyQuota <= 0) return false;
  return input.currentCount < input.dailyQuota;
}

export function ingestTodo(
  input: TodoIngestInput,
  actor: string,
): TodoIngestResult {
  const nowIso = new Date().toISOString();
  const dedupeKey = computeDedupeKey(input);
  const createdBy = actor.trim() || 'system';
  const evidence = serializeEvidence(input);

  return withTransaction(() => {
    let existing = getTodoByDedupeKey(dedupeKey);
    if (!existing) {
      const todoId = randomUUID();
      const nextTodo: Todo = {
        id: todoId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: 'open',
        priority: input.priority ?? null,
        dedupe_key: dedupeKey,
        occurrence_count: 1,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        created_by: createdBy,
        created_at: nowIso,
        updated_at: nowIso,
      };

      try {
        insertTodo(nextTodo);
      } catch (error) {
        if (!isUniqueDedupeConflict(error)) throw error;
        existing = getTodoByDedupeKey(dedupeKey);
      }

      if (!existing) {
        insertTodoSourceEvent({
          todo_id: todoId,
          source_type: input.source_type,
          source_id: input.source_id,
          source_run_id: input.source_run_id ?? null,
          trigger_mode: input.trigger_mode ?? null,
          action: 'created',
          evidence,
          created_at: nowIso,
        });
        return {
          action: 'created',
          todo_id: todoId,
          dedupe_key: dedupeKey,
        };
      }
    }

    const patch = buildMergePatch(existing, input, nowIso);
    updateTodoMerge(existing.id, patch);
    insertTodoSourceEvent({
      todo_id: existing.id,
      source_type: input.source_type,
      source_id: input.source_id,
      source_run_id: input.source_run_id ?? null,
      trigger_mode: input.trigger_mode ?? null,
      action: 'merged',
      evidence,
      created_at: nowIso,
    });

    return {
      action: 'merged',
      todo_id: existing.id,
      dedupe_key: dedupeKey,
    };
  });
}

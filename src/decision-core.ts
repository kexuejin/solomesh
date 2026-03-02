import { randomUUID } from 'node:crypto';

import {
  getDecisionItemById,
  insertDecisionItem,
  updateDecisionItemDecision,
  withTransaction,
} from './db.js';
import { ingestTodo, type TodoIngestResult } from './todo-core.js';
import type {
  DecisionItem,
  DecisionItemScopeLevel,
  TodoPriority,
  TodoSourceType,
  TodoTriggerMode,
} from './types.js';

function normalizeText(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function serializeEvidence(input: DecisionItemIngestInput): string | null {
  if (input.evidence === undefined) return null;
  try {
    return JSON.stringify(input.evidence);
  } catch {
    return JSON.stringify(String(input.evidence));
  }
}

function mapSourceToTriggerMode(sourceType: TodoSourceType): TodoTriggerMode {
  return sourceType === 'automation' ? 'automation' : 'manual';
}

export interface DecisionItemSuggestion {
  title?: string;
  description?: string;
  priority?: TodoPriority;
}

export interface DecisionItemIngestInput {
  title: string;
  summary?: string;
  scope_level?: DecisionItemScopeLevel;
  scope_id?: string;
  priority?: TodoPriority;
  source_type: TodoSourceType;
  source_id: string;
  source_run_id?: string;
  evidence?: unknown;
  suggested_todo?: DecisionItemSuggestion;
}

export interface DecisionItemIngestResult {
  decision_item_id: string;
  status: 'pending';
}

export type DecisionItemActionResult =
  | {
      ok: true;
      decision_item_id: string;
      status: 'accepted';
      todo: TodoIngestResult;
    }
  | {
      ok: true;
      decision_item_id: string;
      status: 'ignored';
    }
  | {
      ok: false;
      error: 'not_found' | 'already_decided';
      currentStatus?: 'accepted' | 'ignored';
    };

export function ingestDecisionItem(
  input: DecisionItemIngestInput,
  actor: string,
): DecisionItemIngestResult {
  const nowIso = new Date().toISOString();
  const itemId = randomUUID();
  const createdBy = actor.trim() || 'system';
  const requestedScopeId = normalizeText(input.scope_id);
  const scopeLevel =
    input.scope_level === 'workspace' && requestedScopeId
      ? 'workspace'
      : 'global';
  const scopeId = scopeLevel === 'workspace' ? requestedScopeId : null;
  const nextItem: DecisionItem = {
    id: itemId,
    title: input.title.trim(),
    summary: normalizeText(input.summary),
    status: 'pending',
    scope_level: scopeLevel,
    scope_id: scopeId,
    priority: input.priority ?? null,
    source_type: input.source_type,
    source_id: input.source_id,
    source_run_id: normalizeText(input.source_run_id),
    evidence: serializeEvidence(input),
    suggested_todo_title: normalizeText(input.suggested_todo?.title),
    suggested_todo_description: normalizeText(input.suggested_todo?.description),
    suggested_todo_priority: input.suggested_todo?.priority ?? null,
    created_by: createdBy,
    created_at: nowIso,
    updated_at: nowIso,
    decided_at: null,
    decided_by: null,
    accepted_todo_id: null,
  };

  insertDecisionItem(nextItem);
  return {
    decision_item_id: itemId,
    status: 'pending',
  };
}

export function acceptDecisionItem(
  decisionItemId: string,
  actor: string,
): DecisionItemActionResult {
  return withTransaction(() => {
    const item = getDecisionItemById(decisionItemId);
    if (!item) {
      return { ok: false, error: 'not_found' };
    }
    if (item.status !== 'pending') {
      return {
        ok: false,
        error: 'already_decided',
        currentStatus: item.status,
      };
    }

    const todo = ingestTodo(
      {
        title: item.suggested_todo_title ?? item.title,
        description: item.suggested_todo_description ?? item.summary ?? undefined,
        priority: item.suggested_todo_priority ?? item.priority ?? undefined,
        source_type: item.source_type,
        source_id: item.source_id,
        source_run_id: item.source_run_id ?? undefined,
        trigger_mode: mapSourceToTriggerMode(item.source_type),
        evidence: {
          decision_item_id: item.id,
          decision_item_title: item.title,
          decision_item_summary: item.summary,
          decision_item_evidence: item.evidence,
        },
      },
      actor,
    );

    const nowIso = new Date().toISOString();
    updateDecisionItemDecision(item.id, {
      status: 'accepted',
      decided_at: nowIso,
      decided_by: actor,
      accepted_todo_id: todo.todo_id,
    });

    return {
      ok: true,
      decision_item_id: item.id,
      status: 'accepted' as const,
      todo,
    };
  });
}

export function ignoreDecisionItem(
  decisionItemId: string,
  actor: string,
): DecisionItemActionResult {
  return withTransaction(() => {
    const item = getDecisionItemById(decisionItemId);
    if (!item) {
      return { ok: false, error: 'not_found' };
    }
    if (item.status !== 'pending') {
      return {
        ok: false,
        error: 'already_decided',
        currentStatus: item.status,
      };
    }

    const nowIso = new Date().toISOString();
    updateDecisionItemDecision(item.id, {
      status: 'ignored',
      decided_at: nowIso,
      decided_by: actor,
      accepted_todo_id: null,
    });

    return {
      ok: true,
      decision_item_id: item.id,
      status: 'ignored' as const,
    };
  });
}

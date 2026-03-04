import test from 'node:test';
import assert from 'node:assert/strict';

import type { DecisionItem } from '../web/src/stores/decision-items';
import type { TodoItem } from '../web/src/stores/todos';
import { buildWorkbenchColumns } from '../web/src/lib/workbench';

function createDecisionItem(
  patch: Partial<DecisionItem> = {},
): DecisionItem {
  const id = patch.id ?? `decision-${Math.random().toString(36).slice(2, 8)}`;
  const now = patch.created_at ?? '2026-03-04T01:00:00.000Z';
  return {
    id,
    title: patch.title ?? id,
    summary: patch.summary ?? null,
    status: patch.status ?? 'pending',
    scope_level: patch.scope_level ?? 'workspace',
    scope_id: patch.scope_id ?? 'main',
    priority: patch.priority ?? null,
    source_type: patch.source_type ?? 'manual',
    source_id: patch.source_id ?? 'user:demo',
    source_run_id: patch.source_run_id ?? null,
    evidence: patch.evidence ?? null,
    suggested_todo_title: patch.suggested_todo_title ?? null,
    suggested_todo_description: patch.suggested_todo_description ?? null,
    suggested_todo_priority: patch.suggested_todo_priority ?? null,
    created_by: patch.created_by ?? 'demo',
    created_at: now,
    updated_at: patch.updated_at ?? now,
    decided_at: patch.decided_at ?? null,
    decided_by: patch.decided_by ?? null,
    accepted_todo_id: patch.accepted_todo_id ?? null,
  };
}

function createTodoItem(
  patch: Partial<TodoItem> = {},
): TodoItem {
  const id = patch.id ?? `todo-${Math.random().toString(36).slice(2, 8)}`;
  const now = patch.created_at ?? '2026-03-04T01:00:00.000Z';
  return {
    id,
    title: patch.title ?? id,
    description: patch.description ?? null,
    status: patch.status ?? 'open',
    priority: patch.priority ?? null,
    dedupe_key: patch.dedupe_key ?? id,
    occurrence_count: patch.occurrence_count ?? 1,
    first_seen_at: patch.first_seen_at ?? now,
    last_seen_at: patch.last_seen_at ?? now,
    created_by: patch.created_by ?? 'demo',
    created_at: now,
    updated_at: patch.updated_at ?? now,
  };
}

test('workbench projection maps pending decisions and todo statuses into 5 board columns', () => {
  const decisionManual = createDecisionItem({
    id: 'd-manual',
    source_type: 'manual',
    created_at: '2026-03-04T01:00:00.000Z',
  });
  const decisionTracking = createDecisionItem({
    id: 'd-tracking',
    source_type: 'automation',
    created_at: '2026-03-04T02:00:00.000Z',
  });
  const decisionAccepted = createDecisionItem({
    id: 'd-accepted',
    source_type: 'manual',
    status: 'accepted',
  });

  const todoOpen = createTodoItem({ id: 't-open', status: 'open' });
  const todoInProgress = createTodoItem({ id: 't-progress', status: 'in_progress' });
  const todoDone = createTodoItem({ id: 't-done', status: 'done' });
  const todoArchived = createTodoItem({ id: 't-archived', status: 'archived' });

  const columns = buildWorkbenchColumns(
    [decisionManual, decisionTracking, decisionAccepted],
    [todoOpen, todoInProgress, todoDone, todoArchived],
  );

  assert.deepEqual(columns.triage.map((item) => item.id), ['d-manual']);
  assert.deepEqual(columns.tracking.map((item) => item.id), ['d-tracking']);
  assert.deepEqual(columns.queued.map((item) => item.id), ['t-open']);
  assert.deepEqual(columns.inProgress.map((item) => item.id), ['t-progress']);
  assert.deepEqual(columns.done.map((item) => item.id), ['t-done']);
});

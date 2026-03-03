import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('tasks route exposes run-now endpoint', () => {
  const source = read('src/routes/tasks.ts');
  assert.ok(
    source.includes("tasksRoutes.post('/:id/run-now'"),
    'tasks route should expose POST /:id/run-now',
  );
  assert.ok(
    source.includes('triggerTaskRunNow'),
    'run-now endpoint should call scheduler trigger',
  );
});

test('task list card wires run-now action', () => {
  const source = read('web/src/components/tasks/TaskCard.tsx');
  assert.ok(
    source.includes("t('tasks.card.actionRunNow')"),
    'task card should render localized run-now action',
  );
  assert.ok(
    source.includes('disabled={isRunNowPending}'),
    'task card should disable run-now action while pending',
  );
  assert.ok(
    source.includes("t('tasks.card.actionRunNowPending')"),
    'task card should render localized pending label for run-now action',
  );
});

test('tasks page tracks per-task run-now pending state', () => {
  const source = read('web/src/pages/TasksPage.tsx');
  assert.ok(
    source.includes('runNowPendingIds'),
    'tasks page should track pending run-now task ids',
  );
  assert.ok(
    source.includes('isRunNowPending={!!runNowPendingIds[task.id]}'),
    'tasks page should pass pending state to task card',
  );
});

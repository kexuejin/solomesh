import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled_tasks schema uses task_config/task_state columns', () => {
  const source = read('src/db.ts');

  assert.ok(source.includes('task_config TEXT'));
  assert.ok(source.includes('task_state TEXT'));
  assert.ok(source.includes("ensureColumn('scheduled_tasks', 'task_config', 'TEXT')"));
  assert.ok(source.includes("ensureColumn('scheduled_tasks', 'task_state', 'TEXT')"));
  assert.ok(source.includes("'task_config'"));
  assert.ok(source.includes("'task_state'"));
});

test('db no longer carries legacy todo_auto_create/workflow_rules migration path', () => {
  const source = read('src/db.ts');

  assert.ok(!source.includes('todo_auto_create'));
  assert.ok(!source.includes('workflow_rules'));
});

test('tasks route accepts task_config in create payload', () => {
  const source = read('src/routes/tasks.ts');

  assert.ok(source.includes('task_config'));
  assert.ok(source.includes('task_config: task_config ?? null'));
  assert.ok(source.includes('task_state: null'));
});

test('task scheduler checks explicit task_config on_error switch only', () => {
  const source = read('src/task-scheduler.ts');

  assert.ok(source.includes('shouldIngestAutomationErrorTodo'));
  assert.ok(source.includes('task.task_config?.on_error?.todo_ingest === true'));
  assert.ok(!source.includes('shouldIngestAutomationTodo'));
});

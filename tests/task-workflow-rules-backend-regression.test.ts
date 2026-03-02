import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled_tasks schema uses workflow_rules column', () => {
  const source = read('src/db.ts');

  assert.ok(source.includes('workflow_rules TEXT'));
  assert.ok(source.includes("ensureColumn('scheduled_tasks', 'workflow_rules', 'TEXT')"));
  assert.ok(source.includes("'workflow_rules'"));
});

test('legacy todo_auto_create rows are mapped to on_error todo rule', () => {
  const source = read('src/db.ts');

  assert.ok(source.includes('todo_auto_create'));
  assert.ok(source.includes('SET workflow_rules = ?'));
  assert.ok(source.includes('on_error'));
  assert.ok(source.includes('todo_ingest'));
});

test('tasks route accepts workflow_rules in create payload', () => {
  const source = read('src/routes/tasks.ts');

  assert.ok(source.includes('workflow_rules'));
  assert.ok(source.includes('workflow_rules: workflow_rules ?? null'));
});

test('task scheduler checks explicit workflow_rules on_error switch only', () => {
  const source = read('src/task-scheduler.ts');

  assert.ok(source.includes('shouldIngestAutomationErrorTodo'));
  assert.ok(source.includes('task.workflow_rules?.on_error?.todo_ingest === true'));
  assert.ok(!source.includes('shouldIngestAutomationTodo'));
});

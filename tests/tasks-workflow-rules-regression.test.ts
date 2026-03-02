import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('create task form emits explicit workflowRules on_error todo flag', () => {
  const source = read('web/src/components/tasks/CreateTaskForm.tsx');

  assert.ok(source.includes('onErrorTodoIngest'));
  assert.ok(source.includes('workflowRules'));
  assert.ok(source.includes('on_error'));
  assert.ok(source.includes('todo_ingest'));
});

test('tasks store forwards workflow_rules payload', () => {
  const source = read('web/src/stores/tasks.ts');

  assert.ok(source.includes('workflowRules'));
  assert.ok(source.includes('workflow_rules'));
});

test('task card/detail render workflow todo rule state', () => {
  const card = read('web/src/components/tasks/TaskCard.tsx');
  const detail = read('web/src/components/tasks/TaskDetail.tsx');

  assert.ok(card.includes('tasks.card.onErrorTodo'));
  assert.ok(detail.includes('tasks.detail.onErrorTodoRule'));
  assert.ok(detail.includes('tasks.detail.enabled'));
  assert.ok(detail.includes('tasks.detail.disabled'));
});

test('i18n messages contain workflow todo rule labels in zh and en', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes('failureRuleTitle'));
  assert.ok(messages.includes('onErrorTodoIngest'));
  assert.ok(messages.includes('onErrorTodoIngestHint'));
  assert.ok(messages.includes('onErrorTodoRule'));
  assert.ok(messages.includes('On error -> Todo'));
  assert.ok(messages.includes('失败写入 Todo'));
});

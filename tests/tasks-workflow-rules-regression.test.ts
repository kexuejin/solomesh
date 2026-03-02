import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('create task form emits explicit taskConfig on_error todo flag', () => {
  const source = read('web/src/components/tasks/CreateTaskForm.tsx');

  assert.ok(source.includes('onErrorTodoIngest'));
  assert.ok(source.includes('template.defaultOnErrorTodoIngest ?? false'));
  assert.ok(source.includes('taskConfig'));
  assert.ok(source.includes('on_error'));
  assert.ok(source.includes('todo_ingest'));
  assert.ok(source.includes('taskConfigJson'));
  assert.ok(source.includes('JSON.parse'));
});

test('generic task form surface does not hardcode competitor plugin fields', () => {
  const createForm = read('web/src/components/tasks/CreateTaskForm.tsx');
  const detail = read('web/src/components/tasks/TaskDetail.tsx');
  const tasksPage = read('web/src/pages/TasksPage.tsx');

  assert.ok(!createForm.includes('competitor_git'));
  assert.ok(!detail.includes('competitor_git'));
  assert.ok(!tasksPage.includes('competitor_git'));
});

test('tasks store forwards and updates task_config payload', () => {
  const source = read('web/src/stores/tasks.ts');

  assert.ok(source.includes('taskConfig'));
  assert.ok(source.includes('task_config'));
  assert.ok(source.includes('updateTaskOnErrorTodoRule'));
  assert.ok(source.includes('tasks.store.updateRuleFailed'));
});

test('task card/detail render workflow todo rule state', () => {
  const card = read('web/src/components/tasks/TaskCard.tsx');
  const detail = read('web/src/components/tasks/TaskDetail.tsx');

  assert.ok(card.includes('tasks.card.onErrorTodo'));
  assert.ok(detail.includes('tasks.detail.onErrorTodoRule'));
  assert.ok(detail.includes('tasks.detail.enabled'));
  assert.ok(detail.includes('tasks.detail.disabled'));
  assert.ok(detail.includes('tasks.detail.enableRule'));
  assert.ok(detail.includes('tasks.detail.disableRule'));
  assert.ok(detail.includes('tasks.detail.updatingRule'));
});

test('i18n messages contain workflow todo rule labels in zh and en', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes('failureRuleTitle'));
  assert.ok(messages.includes('onErrorTodoIngest'));
  assert.ok(messages.includes('onErrorTodoIngestHint'));
  assert.ok(messages.includes('onErrorTodoRule'));
  assert.ok(messages.includes('updateRuleFailed'));
  assert.ok(messages.includes('onErrorTodoRuleEnabledHint'));
  assert.ok(messages.includes('onErrorTodoRuleDisabledHint'));
  assert.ok(messages.includes('On error -> Todo'));
  assert.ok(messages.includes('失败写入 Todo'));
  assert.ok(messages.includes('taskConfigJsonTitle'));
  assert.ok(messages.includes('taskConfigJsonInvalid'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getAutomationTemplates } from '../web/src/components/tasks/automation-presets';
import { zhCN } from '../web/src/i18n/messages';
import { shouldIngestAutomationErrorTodo } from '../src/task-scheduler.js';
import { getWorkflowTemplateRecord, loadWorkflowTemplateRegistry } from '../src/workflow.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function dictT(key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, segment) =>
        (acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[segment]
          : null),
      zhCN,
    );
  return typeof value === 'string' ? value : key;
}

test.beforeEach(() => {
  loadWorkflowTemplateRegistry(undefined);
});

test('scenario 1: manual create route defaults todo source fields', () => {
  const routes = read('src/routes/todos.ts');
  assert.ok(routes.includes("source_type: body.source_type ?? 'manual'"));
  assert.ok(routes.includes('source_id: body.source_id ?? `user:${authUser.id}`'));
  assert.ok(routes.includes("trigger_mode: body.trigger_mode ?? 'manual'"));
});

test('scenario 2: workflow stage completion ingests workflow todo payload', () => {
  const source = read('src/index.ts');
  assert.ok(source.includes("source_type: 'workflow'"));
  assert.ok(
    source.includes('source_id: `${runningWorkflow.templateId}:${currentStage?.id ?? runningWorkflow.currentStageIndex}`'),
  );
  assert.ok(source.includes("source_run_id: `${runningWorkflow.chatJid}:${runningWorkflow.startedAt}`"));
  assert.ok(source.includes("trigger_mode: 'manual'"));
});

test('scenario 3: scheduled automation templates include todo-oriented presets', () => {
  const templates = getAutomationTemplates(dictT);
  const competitor = templates.find((item) => item.id === 'competitor-watch');
  const project = templates.find((item) => item.id === 'project-recommendation');

  assert.ok(competitor);
  assert.ok(project);
  assert.equal(competitor?.scheduleType, 'cron');
  assert.equal(project?.scheduleType, 'cron');
  assert.equal(competitor?.contextMode, 'isolated');
  assert.equal(project?.contextMode, 'isolated');
  assert.equal(competitor?.defaultOnErrorTodoIngest, true);
  assert.equal(project?.defaultOnErrorTodoIngest, true);
  assert.equal(
    (competitor?.defaultTaskConfig?.plugins as Record<string, unknown> | undefined)
      ?.competitor_git
      !== undefined,
    true,
  );
  assert.equal(
    competitor?.prompt.includes('repo: https://github.com/example/competitor'),
    false,
  );
});

test('scenario 4: automation failure ingest only runs with explicit on_error rule', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      { task_config: null },
      'task failed',
    ),
    false,
  );
  assert.equal(
    shouldIngestAutomationErrorTodo(
      { task_config: { on_error: { todo_ingest: true } } },
      'task failed',
    ),
    true,
  );

  const scheduler = read('src/task-scheduler.ts');
  assert.ok(scheduler.includes("source_type: 'automation'"));
  assert.ok(scheduler.includes('source_id: task.id'));
  assert.ok(scheduler.includes("trigger_mode: 'automation'"));
});

test('scenario 5: competitor plugin chain exists (workflow + skill)', () => {
  const record = getWorkflowTemplateRecord('competitor-watch');
  assert.ok(record);
  const stages = record?.template.stages ?? [];
  const collect = stages.find((stage) => stage.id === 'collect-signals');
  const emit = stages.find((stage) => stage.id === 'emit-todo');

  assert.deepEqual(collect?.skillRefs ?? [], ['competitor-tracker']);
  assert.equal(collect?.todoIngest?.enabled, false);
  assert.equal(emit?.todoIngest?.enabled, true);
  assert.equal(emit?.todoIngest?.priority, 'high');

  const skill = read('container/skills/competitor-tracker/SKILL.md');
  assert.ok(skill.includes('todo ingest'));
  assert.ok(skill.includes('不直接写数据库'));
});

test('scenario 6: project recommendation plugin chain exists (workflow + skill)', () => {
  const record = getWorkflowTemplateRecord('project-recommendation');
  assert.ok(record);
  const stages = record?.template.stages ?? [];
  const collect = stages.find((stage) => stage.id === 'collect-candidates');
  const emit = stages.find((stage) => stage.id === 'emit-todo');

  assert.deepEqual(collect?.skillRefs ?? [], ['project-recommender']);
  assert.equal(collect?.todoIngest?.enabled, false);
  assert.equal(emit?.todoIngest?.enabled, true);
  assert.equal(emit?.todoIngest?.priority, 'medium');

  const skill = read('container/skills/project-recommender/SKILL.md');
  assert.ok(skill.includes('todo ingest'));
  assert.ok(skill.includes('不直接写数据库'));
});

test('scenario 7: chat command can create automation tasks from built-in templates', () => {
  const source = read('src/index.ts');
  const commandSource = read('src/automation-chat-command.ts');

  assert.ok(source.includes('parseAutomationChatCommandInput'));
  assert.ok(source.includes('buildAutomationTaskSpecFromChatCommand'));
  assert.ok(source.includes('createTask({'));
  assert.ok(commandSource.includes('competitor-watch'));
  assert.ok(commandSource.includes('project-recommendation'));
  assert.ok(source.includes('/auto <template-id>'));
});

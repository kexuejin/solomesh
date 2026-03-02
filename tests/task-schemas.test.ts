import test from 'node:test';
import assert from 'node:assert/strict';

import { TaskCreateSchema, TaskPatchSchema } from '../src/schemas.js';

test('TaskCreateSchema accepts script task with empty prompt and valid script_command', () => {
  const parsed = TaskCreateSchema.safeParse({
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: '',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    execution_type: 'script',
    script_command: 'echo hello',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.execution_type, 'script');
    assert.equal(parsed.data.script_command, 'echo hello');
  }
});

test('TaskCreateSchema rejects script task when script_command is missing', () => {
  const parsed = TaskCreateSchema.safeParse({
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: '',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    execution_type: 'script',
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.includes('script_command'));
  }
});

test('TaskPatchSchema accepts execution_type and script_command fields', () => {
  const parsed = TaskPatchSchema.safeParse({
    execution_type: 'script',
    script_command: 'npm -v',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.execution_type, 'script');
    assert.equal(parsed.data.script_command, 'npm -v');
  }
});

test('TaskPatchSchema accepts explicit workflow todo rule fields', () => {
  const parsed = TaskPatchSchema.safeParse({
    workflow_rules: {
      on_error: {
        todo_ingest: true,
      },
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.workflow_rules?.on_error?.todo_ingest, true);
  }
});

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

test('TaskCreateSchema accepts skill_refs and normalizes whitespace', () => {
  const parsed = TaskCreateSchema.safeParse({
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'run report',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    execution_type: 'agent',
    skill_refs: [' upstream-tracking-report ', 'sync-host-skill'],
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.skill_refs, ['upstream-tracking-report', 'sync-host-skill']);
  }
});

test('TaskCreateSchema rejects invalid skill_refs value', () => {
  const parsed = TaskCreateSchema.safeParse({
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'run report',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    execution_type: 'agent',
    skill_refs: ['bad ref'],
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join('.'));
    assert.ok(paths.some((path) => path.startsWith('skill_refs')));
  }
});

test('TaskPatchSchema accepts skill_refs for dependency updates', () => {
  const parsed = TaskPatchSchema.safeParse({
    skill_refs: ['daily-check'],
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.skill_refs, ['daily-check']);
  }
});

test('TaskCreateSchema accepts operation permission mode and runtime override', () => {
  const parsed = TaskCreateSchema.safeParse({
    group_folder: 'main',
    chat_jid: 'web:main',
    prompt: 'run report',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    operation_permission_mode: 'bypass',
    agent_runtime_override: 'codex',
    execution_environment: 'worktree',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.operation_permission_mode, 'bypass');
    assert.equal(parsed.data.agent_runtime_override, 'codex');
    assert.equal(parsed.data.execution_environment, 'worktree');
  }
});

test('TaskPatchSchema accepts operation permission mode and runtime override', () => {
  const parsed = TaskPatchSchema.safeParse({
    operation_permission_mode: 'default',
    agent_runtime_override: 'gemini',
    execution_environment: 'local',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.operation_permission_mode, 'default');
    assert.equal(parsed.data.agent_runtime_override, 'gemini');
    assert.equal(parsed.data.execution_environment, 'local');
  }
});

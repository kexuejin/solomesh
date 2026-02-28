import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveExecutionModeForGroup,
  resolveEffectiveGroupForExecution,
} from '../src/group-execution-mode.js';

test('im group inherits host mode from non-home web workspace sibling', () => {
  const im = {
    jid: 'feishu:oc_x',
    name: 'IM',
    folder: 'flow-x',
    added_at: '',
    executionMode: 'container' as const,
    is_home: false,
  };
  const web = {
    jid: 'web:abc',
    name: 'Workspace',
    folder: 'flow-x',
    added_at: '',
    executionMode: 'host' as const,
    is_home: false,
    customCwd: '/Users/demo/project',
  };

  const mode = resolveExecutionModeForGroup(im, [im, web]);
  assert.equal(mode, 'host');

  const effective = resolveEffectiveGroupForExecution(im, [im, web]);
  assert.equal(effective.executionMode, 'host');
  assert.equal(effective.customCwd, '/Users/demo/project');
  assert.equal(effective.is_home, false);
});

test('im group prefers home sibling over web sibling', () => {
  const im = {
    jid: 'telegram:123',
    name: 'IM',
    folder: 'main',
    added_at: '',
    executionMode: 'container' as const,
    is_home: false,
  };
  const home = {
    jid: 'web:main',
    name: 'Home',
    folder: 'main',
    added_at: '',
    executionMode: 'host' as const,
    is_home: true,
    customCwd: '/Users/home',
    created_by: 'u1',
  };
  const web = {
    jid: 'web:other',
    name: 'Other',
    folder: 'main',
    added_at: '',
    executionMode: 'container' as const,
    is_home: false,
  };

  const mode = resolveExecutionModeForGroup(im, [im, web, home]);
  assert.equal(mode, 'host');

  const effective = resolveEffectiveGroupForExecution(im, [im, web, home]);
  assert.equal(effective.executionMode, 'host');
  assert.equal(effective.customCwd, '/Users/home');
  assert.equal(effective.is_home, true);
  assert.equal(effective.created_by, 'u1');
});

test('falls back to target mode when no workspace sibling exists', () => {
  const im = {
    jid: 'feishu:only',
    name: 'IM',
    folder: 'isolated',
    added_at: '',
    executionMode: 'container' as const,
    is_home: false,
  };

  const mode = resolveExecutionModeForGroup(im, [im]);
  assert.equal(mode, 'container');

  const effective = resolveEffectiveGroupForExecution(im, [im]);
  assert.equal(effective.executionMode, 'container');
  assert.equal(effective.is_home, false);
});

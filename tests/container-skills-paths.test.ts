import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveContainerSkillTargets } from '../src/container-runner.ts';

test('claude includes claude skills path', () => {
  const targets = resolveContainerSkillTargets('claude');
  assert.deepEqual(targets, ['/home/node/.claude/skills']);
});

test('codex includes codex skills path', () => {
  const targets = resolveContainerSkillTargets('codex');
  assert.ok(targets.includes('/home/node/.agents/skills'));
});

test('gemini includes gemini skills path', () => {
  const targets = resolveContainerSkillTargets('gemini');
  assert.deepEqual(targets, ['/home/node/.gemini/skills']);
});

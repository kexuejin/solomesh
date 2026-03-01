import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveContainerSkillTargets } from '../src/container-runner.ts';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

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

test('container entrypoint links skills for claude/codex/gemini targets', () => {
  const source = read('container/entrypoint.sh');
  assert.ok(source.includes('/home/node/.claude/skills'));
  assert.ok(source.includes('/home/node/.agents/skills'));
  assert.ok(source.includes('/home/node/.gemini/skills'));
});

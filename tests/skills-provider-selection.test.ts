import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSkillsInstallArgs, getGlobalSkillsDirForProvider } from '../src/skills-provider.ts';

test('build install args for codex', () => {
  const args = buildSkillsInstallArgs('vercel-labs/agent-skills', 'codex');
  assert.deepEqual(args, [
    '-y',
    'skills',
    'add',
    'vercel-labs/agent-skills',
    '--global',
    '--yes',
    '-a',
    'codex',
  ]);
});

test('build install args for claude', () => {
  const args = buildSkillsInstallArgs('vercel-labs/agent-skills', 'claude');
  assert.deepEqual(args, [
    '-y',
    'skills',
    'add',
    'vercel-labs/agent-skills',
    '--global',
    '--yes',
    '-a',
    'claude-code',
  ]);
});

test('global skills dir follows provider runtime', () => {
  assert.equal(getGlobalSkillsDirForProvider('claude').endsWith('/.claude/skills'), true);
  assert.equal(getGlobalSkillsDirForProvider('codex').endsWith('/.agents/skills'), true);
});

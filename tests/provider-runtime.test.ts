import test from 'node:test';
import assert from 'node:assert/strict';

import { getProviderRuntime } from '../src/provider-runtime.ts';

test('claude runtime mapping', () => {
  const rt = getProviderRuntime('claude');
  assert.equal(rt.skillInstallAgent, 'claude-code');
  assert.equal(rt.globalSkillsDirName, '.claude/skills');
  assert.equal(rt.supportsSkillsInstall, true);
  assert.equal(rt.primaryMemoryFileName, 'CLAUDE.md');
});

test('codex runtime mapping', () => {
  const rt = getProviderRuntime('codex');
  assert.equal(rt.skillInstallAgent, 'codex');
  assert.equal(rt.globalSkillsDirName, '.agents/skills');
  assert.equal(rt.supportsSkillsInstall, true);
  assert.equal(rt.primaryMemoryFileName, 'AGENTS.md');
});

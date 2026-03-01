import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRuntimeMemoryProfilePlugin,
  listRuntimeMemoryProfilePlugins,
  listRuntimeMemoryFileNames,
} from '../src/runtime-memory-profile.ts';

test('runtime memory profile plugins are registered for all runtimes', () => {
  const plugins = listRuntimeMemoryProfilePlugins();
  assert.deepEqual(
    plugins.map((plugin) => plugin.runtime).sort(),
    ['claude', 'codex', 'gemini'],
  );
});

test('gemini plugin defines GEMINI.md as primary and keeps AGENTS.md compatibility', () => {
  const plugin = getRuntimeMemoryProfilePlugin('gemini');
  assert.equal(plugin.primaryFileName, 'GEMINI.md');
  assert.deepEqual(plugin.compatibleFileNames, ['AGENTS.md', 'CLAUDE.md']);
  assert.equal(plugin.migrationHint.strategy, 'newest_wins');
});

test('listRuntimeMemoryFileNames follows plugin order', () => {
  assert.deepEqual(listRuntimeMemoryFileNames('claude'), [
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
  ]);
  assert.deepEqual(listRuntimeMemoryFileNames('codex'), [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
  ]);
});

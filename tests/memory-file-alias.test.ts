import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPrimaryMemoryFileName,
  listCompanionPrimaryMemoryFileNames,
  listRuntimePrimaryMemoryFileNames,
} from '../src/memory-file-alias.ts';

test('returns CLAUDE.md for claude provider', () => {
  assert.equal(getPrimaryMemoryFileName('claude'), 'CLAUDE.md');
});

test('returns AGENTS.md for codex provider', () => {
  assert.equal(getPrimaryMemoryFileName('codex'), 'AGENTS.md');
});

test('returns GEMINI.md for gemini provider', () => {
  assert.equal(getPrimaryMemoryFileName('gemini'), 'GEMINI.md');
});

test('prefers GEMINI.md and keeps AGENTS.md fallback for gemini runtime', () => {
  assert.deepEqual(listRuntimePrimaryMemoryFileNames('gemini'), [
    'GEMINI.md',
    'AGENTS.md',
    'CLAUDE.md',
  ]);
});

test('sync companions include AGENTS.md and CLAUDE.md for GEMINI.md', () => {
  assert.deepEqual(listCompanionPrimaryMemoryFileNames('GEMINI.md'), [
    'CLAUDE.md',
    'AGENTS.md',
  ]);
});

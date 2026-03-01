import test from 'node:test';
import assert from 'node:assert/strict';

import { listSessionCleanupTargets } from '../src/session-cleanup.ts';

test('cleanup includes claude, codex and gemini dirs', () => {
  const targets = listSessionCleanupTargets('/tmp/sessions/flow-a');
  assert.deepEqual(targets, [
    '/tmp/sessions/flow-a/.claude',
    '/tmp/sessions/flow-a/.codex',
    '/tmp/sessions/flow-a/.gemini',
  ]);
});

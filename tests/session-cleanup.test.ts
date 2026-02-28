import test from 'node:test';
import assert from 'node:assert/strict';

import { listSessionCleanupTargets } from '../src/session-cleanup.ts';

test('cleanup includes claude and codex dirs', () => {
  const targets = listSessionCleanupTargets('/tmp/sessions/flow-a');
  assert.deepEqual(targets, [
    '/tmp/sessions/flow-a/.claude',
    '/tmp/sessions/flow-a/.codex',
  ]);
});

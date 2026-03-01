import assert from 'node:assert/strict';
import test from 'node:test';

import { isScriptTaskAdminOnlyMutation } from '../src/task-script-policy.ts';

test('existing script task always requires admin for patch', () => {
  assert.equal(
    isScriptTaskAdminOnlyMutation('script', {}),
    true,
  );
});

test('agent task patch stays non-script when no script fields are touched', () => {
  assert.equal(
    isScriptTaskAdminOnlyMutation('agent', {}),
    false,
  );
});

test('touching script fields requires admin even for agent tasks', () => {
  assert.equal(
    isScriptTaskAdminOnlyMutation('agent', { execution_type: 'script' }),
    true,
  );
  assert.equal(
    isScriptTaskAdminOnlyMutation('agent', { script_command: 'echo 1' }),
    true,
  );
});

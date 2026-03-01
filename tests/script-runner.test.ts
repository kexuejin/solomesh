import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { GROUPS_DIR } from '../src/config.js';
import { runScript } from '../src/script-runner.ts';

const TEST_GROUP = '__script_runner_test__';
const TEST_DIR = path.join(GROUPS_DIR, TEST_GROUP);

test('runScript returns exitCode 0 for successful command', async () => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const result = await runScript('echo hello', TEST_GROUP);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello/);
});

test('runScript preserves explicit non-zero exit code', async () => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const result = await runScript('exit 7', TEST_GROUP);
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 7);
});

test('runScript treats missing command as failure', async () => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const result = await runScript('__definitely_not_a_real_command__', TEST_GROUP);
  assert.equal(result.timedOut, false);
  assert.notEqual(result.exitCode, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldIngestAutomationTodo } from '../src/todo-core.js';

test('quota reached blocks auto-create', () => {
  assert.equal(
    shouldIngestAutomationTodo({
      autoCreate: true,
      dailyQuota: 3,
      currentCount: 3,
      hasError: true,
    }),
    false,
  );
});

test('error and quota available allows auto-create', () => {
  assert.equal(
    shouldIngestAutomationTodo({
      autoCreate: true,
      dailyQuota: 3,
      currentCount: 2,
      hasError: true,
    }),
    true,
  );
});

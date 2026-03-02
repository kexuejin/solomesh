import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldIngestAutomationErrorTodo } from '../src/task-scheduler.js';

test('missing error skips automation todo ingest', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        workflow_rules: {
          on_error: { todo_ingest: true },
        },
      },
      null,
    ),
    false,
  );
});

test('error without explicit on_error.todo_ingest rule skips ingest', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        workflow_rules: {},
      },
      'task failed',
    ),
    false,
  );
});

test('error with explicit on_error.todo_ingest ingests todo', () => {
  assert.equal(
    shouldIngestAutomationErrorTodo(
      {
        workflow_rules: {
          on_error: { todo_ingest: true },
        },
      },
      'task failed',
    ),
    true,
  );
});

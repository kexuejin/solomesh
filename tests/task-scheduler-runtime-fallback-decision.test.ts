import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRetryScheduledTaskRuntimeAttempt } from '../src/task-scheduler.js';

test('retries when runtime result contains retryable 503 text and next runtime exists', () => {
  const shouldRetry = shouldRetryScheduledTaskRuntimeAttempt(
    null,
    'API Error: 503 遇到问题先别慌',
    true,
  );
  assert.equal(shouldRetry, true);
});

test('retries when runtime error contains route family exhaustion', () => {
  const shouldRetry = shouldRetryScheduledTaskRuntimeAttempt(
    'No available accounts for route family: sonnet',
    null,
    true,
  );
  assert.equal(shouldRetry, true);
});

test('does not retry when there is no next runtime', () => {
  const shouldRetry = shouldRetryScheduledTaskRuntimeAttempt(
    'API Error: 503 service unavailable',
    null,
    false,
  );
  assert.equal(shouldRetry, false);
});

test('does not retry for non-retryable output', () => {
  const shouldRetry = shouldRetryScheduledTaskRuntimeAttempt(
    null,
    '任务执行完成',
    true,
  );
  assert.equal(shouldRetry, false);
});

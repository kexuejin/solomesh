import test from 'node:test';
import assert from 'node:assert/strict';

import { mapFetchExceptionToApiError } from '../src/api/error-utils.ts';

test('maps fetch connection failures to backend unavailable hint', () => {
  const err = new TypeError('Failed to fetch');
  const mapped = mapFetchExceptionToApiError(err);
  assert.equal(mapped.status, 0);
  assert.match(mapped.message, /后端服务不可用/);
  assert.match(mapped.message, /3000/);
});

test('maps AbortError to timeout message', () => {
  const err = new DOMException('The operation was aborted.', 'AbortError');
  const mapped = mapFetchExceptionToApiError(err);
  assert.equal(mapped.status, 408);
  assert.equal(mapped.message, '请求超时，请稍后重试');
});

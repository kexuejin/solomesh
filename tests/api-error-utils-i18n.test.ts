import test from 'node:test';
import assert from 'node:assert/strict';

import { mapFetchExceptionToApiError } from '../web/src/api/error-utils';

function withWindowLocale(locale: string, fn: () => void) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (key === 'solomesh.ui.locale' ? locale : null),
    },
  };
  try {
    fn();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
}

test('mapFetchExceptionToApiError returns Chinese copy for zh-CN locale', () => {
  withWindowLocale('zh-CN', () => {
    const err = mapFetchExceptionToApiError(new Error('Failed to fetch'));
    assert.equal(err.status, 0);
    assert.equal(err.message, '后端服务不可用，请确认后端已启动（默认端口 3000）后重试');
  });
});

test('mapFetchExceptionToApiError returns English copy for en locale', () => {
  withWindowLocale('en', () => {
    const err = mapFetchExceptionToApiError(new Error('Failed to fetch'));
    assert.equal(err.status, 0);
    assert.equal(
      err.message,
      'Backend service is unavailable. Ensure backend is running (default port 3000) and retry.',
    );
  });

  withWindowLocale('en', () => {
    const err = mapFetchExceptionToApiError({ name: 'AbortError' });
    assert.equal(err.status, 408);
    assert.equal(err.message, 'Request timed out. Please try again later.');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { decideAgentErrorRetry } from '../src/agent-error-policy.js';

test('gemini token pool empty should not retry', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'RetryableQuotaError: Token error: Token pool is empty',
  );

  assert.equal(result.shouldRetry, false);
  assert.ok(result.userFacingMessage?.includes('Token pool is empty'));
});

test('gemini missing oauth credentials should not retry', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'Gemini 官方模式未检测到登录凭据。请先执行 gemini login。',
  );

  assert.equal(result.shouldRetry, false);
  assert.ok(result.userFacingMessage?.includes('gemini login'));
});

test('gemini missing api key should not retry', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'Gemini API Key 模式未检测到 GEMINI_API_KEY。',
  );

  assert.equal(result.shouldRetry, false);
  assert.ok(result.userFacingMessage?.includes('GEMINI_API_KEY'));
});

test('unknown gemini transient error keeps retry', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'network timeout',
  );

  assert.equal(result.shouldRetry, true);
});

test('non-gemini provider keeps retry policy unchanged', () => {
  const result = decideAgentErrorRetry(
    'claude',
    'model temporarily unavailable',
  );

  assert.equal(result.shouldRetry, true);
});

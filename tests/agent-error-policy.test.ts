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

test('gemini missing api key should not retry', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'Gemini 运行时未检测到 GEMINI_API_KEY。请在设置中填写 API Key。',
  );

  assert.equal(result.shouldRetry, false);
  assert.ok(result.userFacingMessage?.includes('GEMINI_API_KEY'));
});

test('gemini quota exceeded should not retry and should suggest fallback model', () => {
  const result = decideAgentErrorRetry(
    'gemini',
    'status: "RESOURCE_EXHAUSTED"; code: 429; Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro',
  );

  assert.equal(result.shouldRetry, false);
  assert.ok(result.userFacingMessage?.includes('gemini-2.5-flash'));
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

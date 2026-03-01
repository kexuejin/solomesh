import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGeminiAuthMode,
  normalizeGeminiCliHomeRoot,
  resolveGeminiApiKey,
  resolveGeminiCliHomeCandidates,
  isGeminiMissingAuthError,
} from '../container/agent-runner/src/gemini-auth.ts';

test('normalizeGeminiAuthMode defaults to api_key', () => {
  assert.equal(normalizeGeminiAuthMode(undefined), 'api_key');
  assert.equal(normalizeGeminiAuthMode('unknown'), 'api_key');
});

test('normalizeGeminiAuthMode accepts oauth', () => {
  assert.equal(normalizeGeminiAuthMode('oauth'), 'oauth');
  assert.equal(normalizeGeminiAuthMode(' OAUTH '), 'oauth');
});

test('resolveGeminiApiKey reads GEMINI_API_KEY first and falls back to GOOGLE_API_KEY', () => {
  assert.equal(
    resolveGeminiApiKey({ GEMINI_API_KEY: 'gm-123', GOOGLE_API_KEY: 'google-123' }),
    'gm-123',
  );
  assert.equal(
    resolveGeminiApiKey({ GEMINI_API_KEY: '   ', GOOGLE_API_KEY: 'google-123' }),
    'google-123',
  );
  assert.equal(resolveGeminiApiKey({}), '');
});

test('normalizeGeminiCliHomeRoot maps legacy .gemini dir to home root', () => {
  assert.equal(
    normalizeGeminiCliHomeRoot('/tmp/workspace/.gemini'),
    '/tmp/workspace',
  );
  assert.equal(
    normalizeGeminiCliHomeRoot('/tmp/workspace'),
    '/tmp/workspace',
  );
});

test('resolveGeminiCliHomeCandidates uses configured GEMINI_CLI_HOME root only', () => {
  assert.deepEqual(
    resolveGeminiCliHomeCandidates({
      GEMINI_CLI_HOME: '/tmp/workspace/.gemini',
      HOME: '/Users/demo',
    }),
    ['/tmp/workspace'],
  );
});

test('resolveGeminiCliHomeCandidates uses HOME root when GEMINI_CLI_HOME is missing', () => {
  assert.deepEqual(
    resolveGeminiCliHomeCandidates({
      HOME: '/Users/demo',
    }),
    ['/Users/demo'],
  );
});

test('isGeminiMissingAuthError detects missing auth stderr', () => {
  assert.equal(
    isGeminiMissingAuthError(
      'Please set an Auth method in your ~/.gemini/settings.json before running.',
    ),
    true,
  );
  assert.equal(
    isGeminiMissingAuthError(
      'When using Gemini API, you must specify the GEMINI_API_KEY environment variable.',
    ),
    true,
  );
  assert.equal(isGeminiMissingAuthError('network timeout'), false);
});

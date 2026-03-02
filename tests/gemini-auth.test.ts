import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGeminiApiKey,
} from '../container/agent-runner/src/gemini-auth.ts';

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

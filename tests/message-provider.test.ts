import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMessageProvider } from '../src/message-provider.ts';

test('parseMessageProvider accepts supported providers', () => {
  assert.equal(parseMessageProvider('claude'), 'claude');
  assert.equal(parseMessageProvider('codex'), 'codex');
  assert.equal(parseMessageProvider('gemini'), 'gemini');
});

test('parseMessageProvider returns null for unsupported values', () => {
  assert.equal(parseMessageProvider('gpt'), null);
  assert.equal(parseMessageProvider(''), null);
  assert.equal(parseMessageProvider(undefined), null);
});

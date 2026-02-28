import test from 'node:test';
import assert from 'node:assert/strict';

import { getMessageProviderLabel } from '../src/lib/message-provider.ts';

test('maps provider ids to UI labels', () => {
  assert.equal(getMessageProviderLabel('claude'), 'Claude');
  assert.equal(getMessageProviderLabel('codex'), 'Codex');
});

test('returns null for unknown provider ids', () => {
  assert.equal(getMessageProviderLabel('gpt'), null);
  assert.equal(getMessageProviderLabel(null), null);
  assert.equal(getMessageProviderLabel(undefined), null);
});

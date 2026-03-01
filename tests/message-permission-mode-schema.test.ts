import test from 'node:test';
import assert from 'node:assert/strict';

import { MessageCreateSchema } from '../src/schemas.js';

test('message schema accepts operationPermissionMode field', () => {
  const result = MessageCreateSchema.safeParse({
    chatJid: 'web:test',
    content: 'hello',
    operationPermissionMode: 'bypass',
  });
  assert.equal(result.success, true);
});

test('message schema rejects invalid operationPermissionMode values', () => {
  const result = MessageCreateSchema.safeParse({
    chatJid: 'web:test',
    content: 'hello',
    operationPermissionMode: 'unknown',
  });
  assert.equal(result.success, false);
});

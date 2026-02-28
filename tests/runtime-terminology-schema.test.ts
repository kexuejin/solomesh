import test from 'node:test';
import assert from 'node:assert/strict';

import { RuntimeModelSelectionSchema } from '../src/schemas.js';

test('accepts agentRuntime/modelProvider/model fields', () => {
  const result = RuntimeModelSelectionSchema.safeParse({
    agentRuntime: 'codex',
    modelProvider: 'openrouter',
    model: 'gpt-5',
  });
  assert.equal(result.success, true);
});

test('rejects ambiguous legacy field agentProvider', () => {
  const result = RuntimeModelSelectionSchema.safeParse({
    agentProvider: 'codex',
  });
  assert.equal(result.success, false);
});

test('rejects payload without any runtime/model field', () => {
  const result = RuntimeModelSelectionSchema.safeParse({});
  assert.equal(result.success, false);
});

test('rejects unknown extra fields', () => {
  const result = RuntimeModelSelectionSchema.safeParse({
    agentRuntime: 'claude-code',
    runtime: 'codex',
  });
  assert.equal(result.success, false);
});


import test from 'node:test';
import assert from 'node:assert/strict';

import { ContainerEnvSchema, RuntimeSecretsSchema } from '../src/schemas.js';

test('runtime secrets schema rejects URL-like codexApiKey', () => {
  const result = RuntimeSecretsSchema.safeParse({
    codexApiKey: 'https://gateway.example.com/openai',
  });

  assert.equal(result.success, false);
});

test('container env schema rejects URL-like codexApiKey', () => {
  const result = ContainerEnvSchema.safeParse({
    codexApiKey: 'https://gateway.example.com/openai',
  });

  assert.equal(result.success, false);
});

test('runtime secrets schema allows non-URL codexApiKey', () => {
  const result = RuntimeSecretsSchema.safeParse({
    codexApiKey: 'sk-valid-key-123',
  });

  assert.equal(result.success, true);
});

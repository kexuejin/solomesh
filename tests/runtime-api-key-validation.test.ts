import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuntimeEnvLines,
  mergeRuntimeEnvConfig,
  toPublicRuntimeProviderConfig,
  validateRuntimeProviderConfig,
  type RuntimeProviderConfig,
} from '../src/runtime-config.js';

function createBaseConfig(): RuntimeProviderConfig {
  return {
    agentRuntime: 'codex',
    anthropicBaseUrl: '',
    codexBaseUrl: 'https://example.com/openai',
    codexModel: 'gpt-5-codex',
    geminiBaseUrl: '',
    geminiModel: 'gemini-2.5-pro',
    geminiAuthMode: 'api_key',
    anthropicAuthToken: '',
    anthropicApiKey: '',
    claudeCodeOauthToken: '',
    codexApiKey: 'sk-valid-key-123',
    geminiApiKey: '',
    claudeOAuthCredentials: null,
    updatedAt: null,
  };
}

test('validateRuntimeProviderConfig keeps runtime URL checks independent from stale API key values', () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  config.geminiApiKey = 'https://generativelanguage.googleapis.com';

  const errors = validateRuntimeProviderConfig(config);

  assert.equal(errors.length, 0);
});

test('buildRuntimeEnvLines skips invalid codex key that looks like URL', () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';

  const lines = buildRuntimeEnvLines(config);

  assert.ok(
    !lines.some((line) => line.startsWith('CODEX_API_KEY=')),
    `unexpected CODEX_API_KEY line: ${lines.join(', ')}`,
  );
  assert.ok(
    !lines.some((line) => line.startsWith('OPENAI_API_KEY=')),
    `unexpected OPENAI_API_KEY line: ${lines.join(', ')}`,
  );
});

test('mergeRuntimeEnvConfig keeps global codex key when override key is invalid', () => {
  const global = createBaseConfig();
  const merged = mergeRuntimeEnvConfig(global, {
    codexApiKey: 'https://gateway.example.com/openai',
  });

  assert.equal(merged.codexApiKey, global.codexApiKey);
});

test('toPublicRuntimeProviderConfig does not mark URL-like codex key as connected', () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';

  const publicConfig = toPublicRuntimeProviderConfig(config);

  assert.equal(publicConfig.hasCodexApiKey, false);
  assert.equal(publicConfig.codexApiKeyMasked, null);
});

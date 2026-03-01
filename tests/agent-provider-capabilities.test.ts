import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_PROVIDER_IDS,
  getAgentProviderDefinition,
  isAgentProviderConfigured,
  listAgentProviderDefinitions,
} from '../src/agent-providers.ts';

test('agent provider capability matrix is explicit per runtime', () => {
  const claude = getAgentProviderDefinition('claude');
  const codex = getAgentProviderDefinition('codex');
  const gemini = getAgentProviderDefinition('gemini');

  assert.equal(claude.capabilities.supportsMemoryFlush, true);
  assert.equal(claude.capabilities.supportsOAuthLogin, true);
  assert.equal(claude.capabilities.supportsOfficialAuth, true);
  assert.equal(claude.capabilities.supportsThirdPartyGateway, true);
  assert.equal(claude.capabilities.supportsModelOverride, false);
  assert.equal(claude.capabilities.supportsTaskNotificationSynthesis, true);
  assert.equal(claude.capabilities.supportsNativeThinkingStream, true);

  assert.equal(codex.capabilities.supportsMemoryFlush, false);
  assert.equal(codex.capabilities.supportsOAuthLogin, false);
  assert.equal(codex.capabilities.supportsOfficialAuth, false);
  assert.equal(codex.capabilities.supportsThirdPartyGateway, false);
  assert.equal(codex.capabilities.supportsModelOverride, true);
  assert.equal(codex.capabilities.supportsTaskNotificationSynthesis, false);
  assert.equal(codex.capabilities.supportsNativeThinkingStream, true);

  assert.equal(gemini.capabilities.supportsMemoryFlush, false);
  assert.equal(gemini.capabilities.supportsOAuthLogin, false);
  assert.equal(gemini.capabilities.supportsOfficialAuth, false);
  assert.equal(gemini.capabilities.supportsThirdPartyGateway, false);
  assert.equal(gemini.capabilities.supportsModelOverride, true);
  assert.equal(gemini.capabilities.supportsTaskNotificationSynthesis, false);
  assert.equal(gemini.capabilities.supportsNativeThinkingStream, false);
});

test('agent providers list order is stable for runtime selectors', () => {
  const ids = listAgentProviderDefinitions().map((item) => item.id);
  assert.deepEqual(ids, [...AGENT_PROVIDER_IDS]);
});

test('gemini oauth mode is treated as configured without api key', () => {
  assert.equal(
    isAgentProviderConfigured('gemini', {
      geminiAuthMode: 'oauth',
      geminiApiKey: '',
    }),
    true,
  );
  assert.equal(
    isAgentProviderConfigured('gemini', {
      geminiAuthMode: 'api_key',
      geminiApiKey: '',
    }),
    false,
  );
});

test('url-like keys are not treated as configured for sdk runtimes', () => {
  assert.equal(
    isAgentProviderConfigured('codex', {
      codexApiKey: 'https://gateway.example.com/openai',
    }),
    false,
  );
  assert.equal(
    isAgentProviderConfigured('gemini', {
      geminiAuthMode: 'api_key',
      geminiApiKey: 'https://generativelanguage.googleapis.com',
    }),
    false,
  );
});

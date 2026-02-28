import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_PROVIDER_IDS,
  getAgentProviderDefinition,
  listAgentProviderDefinitions,
} from '../src/agent-providers.ts';

test('agent provider capability matrix is explicit per runtime', () => {
  const claude = getAgentProviderDefinition('claude');
  const codex = getAgentProviderDefinition('codex');

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
});

test('agent providers list order is stable for runtime selectors', () => {
  const ids = listAgentProviderDefinitions().map((item) => item.id);
  assert.deepEqual(ids, [...AGENT_PROVIDER_IDS]);
});

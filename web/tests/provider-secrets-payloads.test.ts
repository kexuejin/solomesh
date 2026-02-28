import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCodexSecretsPayload,
  hasSecretPayloadChanges,
  buildOfficialOauthSecretsPayload,
  buildOfficialSetupTokenSecretsPayload,
  buildThirdPartySecretsPayload,
} from '../src/components/settings/provider-secrets-payloads.ts';

test('official OAuth payload does not clear codex key', () => {
  const payload = buildOfficialOauthSecretsPayload({
    accessToken: 'a',
    refreshToken: 'b',
    expiresAt: 123,
    scopes: [],
  });

  assert.equal(payload.clearAnthropicAuthToken, true);
  assert.equal(payload.clearAnthropicApiKey, true);
  assert.equal(payload.clearClaudeCodeOauthToken, true);
  assert.equal('clearCodexApiKey' in payload, false);
});

test('official setup-token payload does not clear codex key', () => {
  const payload = buildOfficialSetupTokenSecretsPayload('setup-token');

  assert.equal(payload.claudeCodeOauthToken, 'setup-token');
  assert.equal(payload.clearAnthropicAuthToken, true);
  assert.equal(payload.clearAnthropicApiKey, true);
  assert.equal(payload.clearRuntimeOAuthCredentials, true);
  assert.equal('clearCodexApiKey' in payload, false);
});

test('third-party payload clears claude oauth credentials but not codex key', () => {
  const payload = buildThirdPartySecretsPayload({ authTokenDirty: true, authToken: 'cr_abc' });

  assert.equal(payload.anthropicAuthToken, 'cr_abc');
  assert.equal(payload.clearClaudeCodeOauthToken, true);
  assert.equal(payload.clearAnthropicApiKey, true);
  assert.equal(payload.clearRuntimeOAuthCredentials, true);
  assert.equal('clearCodexApiKey' in payload, false);
});

test('codex payload only updates codex key when edited', () => {
  const payload = buildCodexSecretsPayload({ codexApiKeyDirty: true, codexApiKey: 'sk-123' });

  assert.deepEqual(payload, {
    codexApiKey: 'sk-123',
  });
});

test('empty payload is treated as no secret changes', () => {
  const payload = buildCodexSecretsPayload({ codexApiKeyDirty: false, codexApiKey: '' });
  assert.equal(hasSecretPayloadChanges(payload), false);
});

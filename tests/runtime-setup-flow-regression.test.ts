import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('runtime settings page keeps default-runtime switch as an explicit action', () => {
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');

  assert.ok(runtimeSection.includes('const handleSaveDefaultRuntime = async () => {'));
  assert.ok(runtimeSection.includes("t('settings.runtime.switchHint')"));
  assert.ok(runtimeSection.includes("t('settings.runtime.setDefault', { label: currentRuntime.label })"));
  assert.ok(runtimeSection.includes('disabled={loading || saving || applying || config?.agentRuntime === engineMode}'));

  // Editing provider credentials should not implicitly switch global runtime.
  assert.equal(count(runtimeSection, 'agentRuntime:'), 1);
  assert.ok(runtimeSection.includes('agentRuntime: engineMode,'));
});

test('setup page supports preparing Claude/Codex/Gemini credentials in one save', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');

  assert.ok(setupPage.includes('const wantsClaude ='));
  assert.ok(setupPage.includes('const wantsCodex ='));
  assert.ok(setupPage.includes('const wantsGemini ='));
  assert.ok(setupPage.includes('if (!wantsClaude && !wantsCodex && !wantsGemini) {'));
  assert.ok(setupPage.includes("t('setupProviders.errors.runtimeRequired')"));

  assert.ok(setupPage.includes('buildOfficialOauthSecretsPayload'));
  assert.ok(setupPage.includes('buildOfficialSetupTokenSecretsPayload'));
  assert.ok(setupPage.includes('buildThirdPartySecretsPayload'));
  assert.ok(setupPage.includes('buildCodexSecretsPayload'));
  assert.ok(setupPage.includes('buildGeminiSecretsPayload'));

  assert.ok(setupPage.includes("t('setupProviders.runtime.multiRuntimeHint')"));
  assert.equal(count(setupPage, 'agentRuntime:'), 1);
  assert.ok(setupPage.includes('await api.put(getRuntimeConfigEndpoint(), { agentRuntime: engineMode });'));
});

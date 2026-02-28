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
  assert.ok(runtimeSection.includes('切换上方 Runtime 仅用于编辑对应 Provider 配置；默认 Runtime 不会自动改变。'));
  assert.ok(runtimeSection.includes('设为默认 Runtime（{currentRuntime.label}）'));
  assert.ok(runtimeSection.includes('disabled={loading || saving || applying || config?.agentRuntime === engineMode}'));

  // Editing provider credentials should not implicitly switch global runtime.
  assert.equal(count(runtimeSection, 'agentRuntime:'), 1);
  assert.ok(runtimeSection.includes('agentRuntime: engineMode,'));
});

test('setup page supports preparing Claude and Codex credentials in one save', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');

  assert.ok(setupPage.includes('const wantsClaude ='));
  assert.ok(setupPage.includes('const wantsCodex ='));
  assert.ok(setupPage.includes('if (!wantsClaude && !wantsCodex) {'));
  assert.ok(setupPage.includes('请至少配置一个 Runtime 的凭据后再继续'));

  assert.ok(setupPage.includes('buildOfficialOauthSecretsPayload'));
  assert.ok(setupPage.includes('buildOfficialSetupTokenSecretsPayload'));
  assert.ok(setupPage.includes('buildThirdPartySecretsPayload'));
  assert.ok(setupPage.includes('buildCodexSecretsPayload'));

  assert.ok(setupPage.includes('可先切换到 Claude/Codex 分别填写凭据，本页保存时会将已填写项一起提交，不会互相清空。'));
  assert.equal(count(setupPage, 'agentRuntime:'), 1);
  assert.ok(setupPage.includes('await api.put(getRuntimeConfigEndpoint(), { agentRuntime: engineMode });'));
});

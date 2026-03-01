import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime config routes expose Gemini OAuth one-click endpoints', () => {
  const source = read('src/routes/config.ts');

  assert.ok(source.includes("'/runtime/gemini/oauth/start'"));
  assert.ok(source.includes("'/runtime/gemini/oauth/callback'"));
  assert.ok(source.includes('saveGeminiOAuthCredentials'));
  assert.ok(source.includes('updateAllGeminiSessionCredentials'));
});

test('runtime config stores Gemini OAuth credentials and publishes connection status', () => {
  const source = read('src/runtime-config.ts');

  assert.ok(source.includes('const GEMINI_OAUTH_FILE'));
  assert.ok(source.includes('export function getGeminiOAuthCredentials()'));
  assert.ok(source.includes('export function saveGeminiOAuthCredentials('));
  assert.ok(source.includes('hasGeminiOAuthCredentials'));
});

test('settings runtime page wires Gemini one-click OAuth flow', () => {
  const source = read('web/src/components/settings/RuntimeSection.tsx');

  assert.ok(source.includes("'/api/config/runtime/gemini/oauth/start'"));
  assert.ok(source.includes("'/api/config/runtime/gemini/oauth/callback'"));
  assert.ok(source.includes('一键登录 Google'));
});

test('host mode exports GEMINI_CLI_HOME as home root path', () => {
  const source = read('src/container-runner.ts');

  assert.ok(source.includes("hostEnv['GEMINI_CLI_HOME'] = path.dirname(groupGeminiDir);"));
});

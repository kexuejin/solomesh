import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime config routes do not expose Gemini OAuth endpoints', () => {
  const source = read('src/routes/config.ts');

  assert.ok(!source.includes("'/runtime/gemini/oauth/start'"));
  assert.ok(!source.includes("'/runtime/gemini/oauth/callback'"));
  assert.ok(!source.includes('gemini_oauth_login'));
});

test('runtime schema keeps Gemini auth mode API-key-only in request surface', () => {
  const source = read('src/schemas.ts');

  assert.ok(source.includes("geminiAuthMode: z.enum(['api_key']).optional()"));
  assert.ok(!source.includes('geminiOAuthCredentials: GeminiOAuthCredentialsSchema.optional()'));
  assert.ok(!source.includes('clearGeminiOAuthCredentials: z.boolean().optional()'));
});

test('settings runtime page keeps Gemini in API key mode only', () => {
  const source = read('web/src/components/settings/RuntimeSection.tsx');

  assert.ok(!source.includes("'/api/config/runtime/gemini/oauth/start'"));
  assert.ok(!source.includes("'/api/config/runtime/gemini/oauth/callback'"));
  assert.ok(!source.includes("t('settings.runtime.gemini.oneClickLogin')"));
  assert.ok(source.includes("const effectiveGeminiAccessMode = 'api_key' as const;"));
});

test('host mode Gemini wiring is SDK-only without CLI home injection', () => {
  const source = read('src/container-runner.ts');

  assert.ok(!source.includes("hostEnv['GEMINI_CLI_HOME']"));
  assert.ok(source.includes("requiredDeps.push('@google/genai');"));
  assert.ok(!source.includes("requiredDeps.push('@google/gemini-cli');"));
});

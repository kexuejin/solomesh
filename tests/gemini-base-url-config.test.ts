import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime config supports gemini base url field', () => {
  const schemas = read('src/schemas.ts');
  const runtimeConfig = read('src/runtime-config.ts');
  const configRoute = read('src/routes/config.ts');

  assert.ok(
    schemas.includes('geminiBaseUrl: z.string().max(2000).optional()'),
  );
  assert.ok(runtimeConfig.includes('geminiBaseUrl'));
  assert.ok(runtimeConfig.includes('GOOGLE_GEMINI_BASE_URL'));
  assert.ok(runtimeConfig.includes("lines.push('GEMINI_AUTH_MODE=api_key');"));
  assert.ok(configRoute.includes('next.geminiBaseUrl = validation.data.geminiBaseUrl;'));
});

test('settings runtime page includes gemini base url input', () => {
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  assert.ok(runtimeSection.includes("t('setupProviders.runtime.generic.geminiBaseUrlLabel')"));
  assert.ok(runtimeSection.includes("t('setupProviders.runtime.generic.geminiBaseUrlPlaceholder')"));
});

test('setup providers page marks gemini base url as api-key-only', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');
  assert.ok(setupPage.includes("t('setupProviders.runtime.generic.geminiBaseUrlApiKeyOnly')"));
  assert.ok(setupPage.includes('disabled={saving}'));
  assert.ok(!setupPage.includes('geminiAccessMode'));
});

test('container env panel marks gemini base url as api-key-only', () => {
  const panel = read('web/src/components/chat/ContainerEnvPanel.tsx');
  assert.ok(panel.includes("t('chat.containerEnv.geminiBaseUrlApiKeyOnly')"));
  assert.ok(panel.includes('disabled={controlsBusy}'));
  assert.ok(!panel.includes('setGeminiAuthMode'));
});

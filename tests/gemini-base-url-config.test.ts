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
  assert.ok(configRoute.includes('next.geminiBaseUrl = validation.data.geminiBaseUrl;'));
});

test('settings runtime page includes gemini base url input', () => {
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  assert.ok(runtimeSection.includes('value={geminiBaseUrl}'));
  assert.ok(runtimeSection.includes('onChange={(e) => setGeminiBaseUrl(e.target.value)}'));
  assert.ok(runtimeSection.includes("t('setupProviders.runtime.generic.geminiBaseUrlLabel')"));
  assert.ok(runtimeSection.includes("t('setupProviders.runtime.generic.geminiBaseUrlPlaceholder')"));
});

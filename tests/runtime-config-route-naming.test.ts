import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('config routes use runtime namespace only', () => {
  const configRoutes = read('src/routes/config.ts');

  assert.ok(configRoutes.includes("configRoutes.get('/runtimes'"));
  assert.ok(!configRoutes.includes("configRoutes.get('/providers'"));
  assert.ok(configRoutes.includes("configRoutes.get('/runtime'"));
  assert.ok(configRoutes.includes("configRoutes.get(\n  '/runtime/custom-env'"));
  assert.ok(configRoutes.includes("configRoutes.put('/runtime'"));
  assert.ok(configRoutes.includes("configRoutes.put(\n  '/runtime/custom-env'"));
  assert.ok(configRoutes.includes("configRoutes.put(\n  '/runtime/secrets'"));
  assert.ok(configRoutes.includes("configRoutes.post(\n  '/runtime/apply'"));
  assert.ok(configRoutes.includes("configRoutes.post(\n  '/runtime/oauth/start'"));
  assert.ok(configRoutes.includes("configRoutes.post(\n  '/runtime/oauth/callback'"));

  assert.ok(!configRoutes.includes("'/claude'"));
  assert.ok(!configRoutes.includes("'/claude/custom-env'"));
  assert.ok(!configRoutes.includes("'/claude/secrets'"));
  assert.ok(!configRoutes.includes("'/claude/apply'"));
  assert.ok(!configRoutes.includes("'/claude/oauth/start'"));
  assert.ok(!configRoutes.includes("'/claude/oauth/callback'"));
  assert.ok(!configRoutes.includes("'/provider'"));
  assert.ok(!configRoutes.includes("'/provider/custom-env'"));
  assert.ok(!configRoutes.includes("'/provider/secrets'"));
  assert.ok(!configRoutes.includes("'/provider/apply'"));
});

test('web config endpoints and oauth calls target runtime namespace', () => {
  const endpoints = read('web/src/api/runtime-endpoints.ts');
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');

  assert.ok(endpoints.includes("const RUNTIME_CONFIG_BASE = '/api/config/runtime';"));

  assert.ok(runtimeSection.includes("'/api/config/runtime/oauth/start'"));
  assert.ok(runtimeSection.includes("'/api/config/runtime/oauth/callback'"));
  assert.ok(setupPage.includes("'/api/config/runtime/oauth/start'"));
  assert.ok(setupPage.includes("'/api/config/runtime/oauth/callback'"));

  assert.ok(!runtimeSection.includes("'/api/config/claude/oauth/start'"));
  assert.ok(!runtimeSection.includes("'/api/config/claude/oauth/callback'"));
  assert.ok(!setupPage.includes("'/api/config/claude/oauth/start'"));
  assert.ok(!setupPage.includes("'/api/config/claude/oauth/callback'"));
});

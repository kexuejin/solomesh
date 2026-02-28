import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('auth setupStatus payload uses runtime naming', () => {
  const authRoute = read('src/routes/auth.ts');

  assert.ok(authRoute.includes('agentRuntime'));
  assert.ok(authRoute.includes('activeRuntimeConfigured'));
  assert.ok(authRoute.includes('configuredRuntimes'));

  assert.ok(!authRoute.includes('agentProvider:'));
  assert.ok(!authRoute.includes('providerConfigured'));
  assert.ok(!authRoute.includes('claudeConfigured'));
  assert.ok(!authRoute.includes('codexConfigured'));
  assert.ok(!authRoute.includes('configuredProviders'));
});

test('web auth store setupStatus type uses runtime naming', () => {
  const authStore = read('web/src/stores/auth.ts');

  assert.ok(authStore.includes("agentRuntime?: 'claude' | 'codex';"));
  assert.ok(authStore.includes('activeRuntimeConfigured?: boolean;'));
  assert.ok(authStore.includes("configuredRuntimes?: Partial<Record<'claude' | 'codex', boolean>>;"));

  assert.ok(!authStore.includes("agentProvider?: 'claude' | 'codex';"));
  assert.ok(!authStore.includes('providerConfigured?: boolean;'));
  assert.ok(!authStore.includes('claudeConfigured: boolean;'));
  assert.ok(!authStore.includes('codexConfigured?: boolean;'));
  assert.ok(!authStore.includes('configuredProviders?:'));
});

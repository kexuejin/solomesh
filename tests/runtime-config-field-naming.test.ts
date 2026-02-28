import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime config schema and public type use agentRuntime field', () => {
  const schemas = read('src/schemas.ts');
  const runtimeConfig = read('src/runtime-config.ts');

  assert.ok(schemas.includes('agentRuntime: z.enum(AGENT_PROVIDER_IDS).optional()'));
  assert.ok(!schemas.includes('agentProvider: z.enum(AGENT_PROVIDER_IDS).optional()'));

  assert.ok(runtimeConfig.includes('agentRuntime: AgentProvider;'));
  assert.ok(!runtimeConfig.includes('agentProvider: AgentProvider;'));
});

test('runtime config UI requests use agentRuntime instead of agentProvider', () => {
  const setup = read('web/src/pages/SetupProvidersPage.tsx');
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');

  assert.ok(setup.includes('agentRuntime: engineMode'));
  assert.ok(!setup.includes('agentProvider:'));

  assert.ok(runtimeSection.includes('agentRuntime: engineMode'));
  assert.ok(!runtimeSection.includes('agentProvider:'));
});

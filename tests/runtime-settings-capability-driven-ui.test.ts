import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime settings UI consumes runtime definitions endpoint', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  const containerEnvPanel = read('web/src/components/chat/ContainerEnvPanel.tsx');

  assert.ok(setupPage.includes("'/api/config/runtimes'"));
  assert.ok(runtimeSection.includes("'/api/config/runtimes'"));
  assert.ok(containerEnvPanel.includes("'/api/config/runtimes'"));
});

test('runtime settings UI uses capability flags for runtime-specific forms', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  const containerEnvPanel = read('web/src/components/chat/ContainerEnvPanel.tsx');

  assert.ok(setupPage.includes('supportsOAuthLogin'));
  assert.ok(setupPage.includes('supportsThirdPartyGateway'));
  assert.ok(setupPage.includes('supportsModelOverride'));

  assert.ok(runtimeSection.includes('supportsOAuthLogin'));
  assert.ok(runtimeSection.includes('supportsThirdPartyGateway'));
  assert.ok(runtimeSection.includes('supportsModelOverride'));

  assert.ok(containerEnvPanel.includes('supportsThirdPartyGateway'));
  assert.ok(containerEnvPanel.includes('supportsModelOverride'));
});

test('runtime settings/chat pages reuse shared runtime definitions', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');
  const runtimeSection = read('web/src/components/settings/RuntimeSection.tsx');
  const containerEnvPanel = read('web/src/components/chat/ContainerEnvPanel.tsx');
  const sharedDefs = read('web/src/runtime-definitions.ts');

  assert.ok(setupPage.includes("from '../runtime-definitions'"));
  assert.ok(runtimeSection.includes("from '../../runtime-definitions'"));
  assert.ok(containerEnvPanel.includes("from '../../runtime-definitions'"));
  assert.ok(sharedDefs.includes('DEFAULT_RUNTIME_DEFINITIONS'));
  assert.ok(sharedDefs.includes('normalizeRuntimeDefinitions'));
});

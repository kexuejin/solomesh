import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('settings tab key uses runtime instead of claude', () => {
  const settingsTypes = read('web/src/components/settings/types.ts');
  const settingsPage = read('web/src/pages/SettingsPage.tsx');
  const settingsNav = read('web/src/components/settings/SettingsNav.tsx');

  assert.ok(settingsTypes.includes("| 'runtime'"));
  assert.ok(!settingsTypes.includes("| 'claude'"));

  assert.ok(settingsPage.includes("'runtime'"));
  assert.ok(!settingsPage.includes("activeTab === 'claude'"));

  assert.ok(settingsNav.includes("key: 'runtime'"));
  assert.ok(!settingsNav.includes("key: 'claude'"));
});

test('workflow dependency suggested tab points to runtime settings', () => {
  const server = read('src/index.ts');
  const systemMessage = read('web/src/lib/system-message.ts');
  const messageList = read('web/src/components/chat/MessageList.tsx');

  assert.ok(server.includes("type WorkflowDependencySuggestedTab = 'runtime' | 'my-channels' | 'skills' | 'workflows'"));
  assert.ok(server.includes("if (dependencyType === 'provider') return 'runtime';"));

  assert.ok(systemMessage.includes("export type WorkflowDependencySuggestedTab = 'runtime' | 'my-channels' | 'skills' | 'workflows';"));
  assert.ok(systemMessage.includes("normalized === 'runtime'"));
  assert.ok(systemMessage.includes("if (dependencyType === 'provider') return 'runtime';"));

  assert.ok(messageList.includes("if (tab === 'runtime') return 'Agent 运行时';"));
});

test('setup flow redirects to runtime tab', () => {
  const setupPage = read('web/src/pages/SetupProvidersPage.tsx');

  assert.ok(setupPage.includes('/settings?tab=runtime'));
  assert.ok(!setupPage.includes('/settings?tab=claude'));
});

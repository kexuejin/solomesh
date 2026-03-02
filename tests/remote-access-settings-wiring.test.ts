import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('settings includes remote-access tab type and nav entry', () => {
  const settingsTypes = read('web/src/components/settings/types.ts');
  const settingsNav = read('web/src/components/settings/SettingsNav.tsx');

  assert.ok(settingsTypes.includes("| 'remote-access'"));
  assert.ok(settingsNav.includes("key: 'remote-access'"));
  assert.ok(settingsNav.includes("labelKey: 'settings.tabs.remoteAccess'"));
});

test('settings page routes remote-access tab to RemoteAccessSection', () => {
  const settingsPage = read('web/src/pages/SettingsPage.tsx');

  assert.ok(settingsPage.includes("'remote-access'"));
  assert.ok(
    settingsPage.includes("'remote-access': 'settings.tabs.remoteAccess'"),
  );
  assert.ok(
    settingsPage.includes("activeTab === 'remote-access' && <RemoteAccessSection"),
  );
});

test('remote access section calls token verify/revoke/list endpoints', () => {
  const section = read('web/src/components/settings/RemoteAccessSection.tsx');

  assert.ok(section.includes('/api/remote-access/tokens/verify'));
  assert.ok(section.includes('/api/remote-access/tokens'));
  assert.ok(section.includes('/api/remote-access/tokens/revoke'));
  assert.ok(section.includes('/api/remote-access/tokens/revoke-by-id'));
  assert.ok(section.includes('/api/remote-access/public/entry'));
  assert.ok(section.includes('settings.remoteAccess.verifyToken'));
  assert.ok(section.includes('settings.remoteAccess.revokeToken'));
  assert.ok(section.includes('settings.remoteAccess.tokenHistoryTitle'));
  assert.ok(section.includes('providerLocked'));
  assert.ok(section.includes("const availableNgrok ="));
});

test('i18n dictionaries define remote access tab and section keys', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes("remoteAccess: '远程访问'"));
  assert.ok(messages.includes("remoteAccess: 'Remote Access'"));
  assert.ok(messages.includes('remoteAccess: {'));
  assert.ok(messages.includes('verifyToken'));
  assert.ok(messages.includes('revokeToken'));
  assert.ok(messages.includes('tokenHistoryTitle'));
  assert.ok(messages.includes('tokenStatus'));
});

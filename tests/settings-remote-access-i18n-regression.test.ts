import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { zhCN, en } from '../web/src/i18n/messages';

function resolveMessage(tree: Record<string, unknown>, key: string): string | null {
  const segments = key.split('.');
  let node: unknown = tree;
  for (const segment of segments) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : null;
}

function extractRemoteAccessKeysFromSection(): string[] {
  const source = fs.readFileSync('web/src/components/settings/RemoteAccessSection.tsx', 'utf8');
  const keys = [...source.matchAll(/t\('([^']+)'/g)]
    .map((match) => match[1])
    .filter((key): key is string => Boolean(key) && key.startsWith('settings.remoteAccess.'));
  return [...new Set(keys)].sort();
}

test('settings tabs include remote access label in zh and en', () => {
  assert.equal(resolveMessage(zhCN as unknown as Record<string, unknown>, 'settings.tabs.remoteAccess') !== null, true);
  assert.equal(resolveMessage(en as unknown as Record<string, unknown>, 'settings.tabs.remoteAccess') !== null, true);
});

test('all remote access i18n keys used by section exist in zh and en', () => {
  const keys = extractRemoteAccessKeysFromSection();
  assert.ok(keys.length > 0, 'no remote access keys found in section');

  const missingZh = keys.filter((key) => resolveMessage(zhCN as unknown as Record<string, unknown>, key) === null);
  const missingEn = keys.filter((key) => resolveMessage(en as unknown as Record<string, unknown>, key) === null);

  assert.deepEqual(missingZh, [], `missing zh keys: ${missingZh.join(', ')}`);
  assert.deepEqual(missingEn, [], `missing en keys: ${missingEn.join(', ')}`);
});

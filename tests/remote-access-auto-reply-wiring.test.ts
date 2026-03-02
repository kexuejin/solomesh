import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web message handler wires remote-access auto reply for workspace links', () => {
  const web = read('src/web.ts');

  assert.ok(web.includes('looksLikeRemoteAccessLinkRequest'));
  assert.ok(web.includes('buildWorkspacePublicEntryPath'));
  assert.ok(web.includes('remoteAccessKernel.createAccessLink'));
  assert.ok(web.includes('Remote access link for workspace'));
});

test('scheduler message pipeline wires remote-access auto reply for IM channels', () => {
  const index = read('src/index.ts');

  assert.ok(index.includes('looksLikeRemoteAccessLinkRequest'));
  assert.ok(index.includes('buildWorkspacePublicEntryPath'));
  assert.ok(index.includes('remoteAccessKernel.createAccessLink'));
  assert.ok(index.includes('await sendMessage(chatJid,'));
});

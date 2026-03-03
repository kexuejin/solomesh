import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('chat workspace header includes remote-access entry action', () => {
  const chatView = read('web/src/components/chat/ChatView.tsx');

  assert.ok(chatView.includes('/api/remote-access/links'));
  assert.ok(chatView.includes('path: `/chat/${encodeURIComponent(group.folder)}`'));
  assert.ok(chatView.includes('chat.view.actions.remoteAccess'));
});

test('chat i18n dictionaries include workspace remote-access entry labels', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes('remoteAccess: \'远程访问\''));
  assert.ok(messages.includes('remoteAccess: \'Remote Access\''));
});

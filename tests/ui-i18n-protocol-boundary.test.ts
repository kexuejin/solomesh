import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('teammate forwarding wrapper stays protocol-stable (non-localized)', () => {
  const source = read('web/src/components/chat/ChatView.tsx');

  assert.ok(
    source.includes('`[Send to Teammate "${taskDesc}"]: ${content}`'),
    'ChatView should keep stable teammate forwarding wrapper',
  );
  assert.ok(
    !source.includes("t('chat.view.sdkTask.forwardTemplate'"),
    'ChatView should not localize teammate forwarding wrapper',
  );
});

test('uploaded-files prefix sent to model stays stable (non-localized)', () => {
  const source = read('web/src/components/chat/MessageInput.tsx');

  assert.ok(
    source.includes('[Uploaded files to workspace, please review and use]'),
    'MessageInput should keep stable uploaded-files prefix',
  );
  assert.ok(
    !source.includes("t('chat.messageInput.uploadedFilesPrefix'"),
    'MessageInput should not localize uploaded-files prefix sent to model',
  );
});

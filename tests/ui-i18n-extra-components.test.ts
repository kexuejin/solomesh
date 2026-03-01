import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/components/common/ConnectionBanner.tsx',
  'web/src/components/common/ConfirmDialog.tsx',
  'web/src/components/common/EmojiPicker.tsx',
  'web/src/components/common/SearchInput.tsx',
  'web/src/components/chat/RenameDialog.tsx',
  'web/src/components/settings/RegistrationSection.tsx',
  'web/src/components/shared/DirectoryBrowser.tsx',
] as const;

test('extra components use i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('directory browser error fallbacks use i18n keys', () => {
  const source = read('web/src/components/shared/DirectoryBrowser.tsx');
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(source.includes("shared.directoryBrowser.errors.loadDirectoriesFailed"));
  assert.ok(source.includes("shared.directoryBrowser.errors.createFolderFailed"));
  assert.ok(!source.includes("'Failed to load directories'"));
  assert.ok(!source.includes("'Failed to create folder'"));
  assert.ok(messages.includes('directoryBrowser: {'));
  assert.ok(messages.includes('loadDirectoriesFailed'));
  assert.ok(messages.includes('createFolderFailed'));
});

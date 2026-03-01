import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/components/users/UserListTab.tsx',
  'web/src/components/users/InviteCodesTab.tsx',
  'web/src/components/users/AuditLogTab.tsx',
] as const;

test('users utils provides key-based permission label helper', () => {
  const source = read('web/src/components/users/utils.ts');
  assert.ok(source.includes('getPermissionLabel'));
  assert.ok(source.includes('users.permissions.manage_users'));
  assert.ok(!/[一-龥]/.test(source));
});

test('users module uses i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('users role selectors avoid hardcoded role labels', () => {
  for (const relPath of [
    'web/src/components/users/UserListTab.tsx',
    'web/src/components/users/InviteCodesTab.tsx',
  ] as const) {
    const source = read(relPath);
    assert.ok(!/>\s*member\s*</.test(source), `${relPath} should not hardcode member label`);
    assert.ok(!/>\s*admin\s*</.test(source), `${relPath} should not hardcode admin label`);
  }
});

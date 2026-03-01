import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('users page uses i18n dictionary keys', () => {
  const source = read('web/src/pages/UsersPage.tsx');
  assert.ok(source.includes('useI18n'));
  assert.ok(!/[一-龥]/.test(source));
});

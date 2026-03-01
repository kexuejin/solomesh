import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/pages/SetupPage.tsx',
  'web/src/pages/LoginPage.tsx',
  'web/src/pages/RegisterPage.tsx',
  'web/src/pages/GroupsPage.tsx',
  'web/src/pages/SettingsPage.tsx',
  'web/src/components/auth/AuthGuard.tsx',
  'web/src/components/layout/NavRail.tsx',
  'web/src/components/layout/BottomTabBar.tsx',
] as const;

test('shell/auth pages use i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

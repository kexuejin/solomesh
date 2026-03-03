import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('login page restores destination from AuthGuard state', () => {
  const loginPage = read('web/src/pages/LoginPage.tsx');

  assert.ok(loginPage.includes('useLocation'));
  assert.ok(loginPage.includes('location.state'));
  assert.ok(loginPage.includes('fromPath'));
  assert.ok(loginPage.includes("fromPath && fromPath !== '/login'"));
});

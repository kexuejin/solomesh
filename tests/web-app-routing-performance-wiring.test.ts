import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('app routes lazy-load non-shell pages to reduce initial bundle', () => {
  const app = read('web/src/App.tsx');

  assert.ok(app.includes("const LoginPage = lazy(() => import('./pages/LoginPage')"));
  assert.ok(app.includes("const RegisterPage = lazy(() => import('./pages/RegisterPage')"));
  assert.ok(app.includes("const SetupPage = lazy(() => import('./pages/SetupPage')"));
  assert.ok(app.includes("const SetupProvidersPage = lazy(() => import('./pages/SetupProvidersPage')"));
  assert.ok(app.includes("const SetupChannelsPage = lazy(() => import('./pages/SetupChannelsPage')"));
  assert.ok(app.includes("const MemoryPage = lazy(() => import('./pages/MemoryPage')"));
  assert.ok(app.includes("const SkillsPage = lazy(() => import('./pages/SkillsPage')"));
  assert.ok(app.includes("const McpServersPage = lazy(() => import('./pages/McpServersPage')"));
  assert.ok(app.includes("const UsersPage = lazy(() => import('./pages/UsersPage')"));
});

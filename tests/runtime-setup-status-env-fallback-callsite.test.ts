import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('setup status path resolves runtime config with env fallback', () => {
  const source = read('src/routes/auth.ts');
  assert.ok(source.includes('resolveRuntimeProviderConfigWithEnvFallback'));
});

test('runtime definitions endpoint uses env fallback for configuredRuntimes', () => {
  const source = read('src/routes/config.ts');
  assert.ok(source.includes('resolveRuntimeProviderConfigWithEnvFallback'));
});

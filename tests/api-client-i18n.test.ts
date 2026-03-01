import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('api client uses i18n key for unauthorized error', () => {
  const source = read('web/src/api/client.ts');

  assert.ok(source.includes('translateLocaleMessage'));
  assert.ok(source.includes("api.errors.unauthorized"));
  assert.ok(!source.includes("new Error('Unauthorized')"));
});

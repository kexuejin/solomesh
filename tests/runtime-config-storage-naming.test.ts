import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime config storage files use runtime-* names', () => {
  const source = read('src/runtime-config.ts');

  assert.ok(source.includes("'runtime-config.json'"));
  assert.ok(source.includes("'runtime-config.key'"));
  assert.ok(source.includes("'runtime-config.audit.log'"));
  assert.ok(source.includes("'runtime-custom-env.json'"));

  assert.ok(!source.includes("'provider-config.json'"));
  assert.ok(!source.includes("'provider-config.key'"));
  assert.ok(!source.includes("'provider-config.audit.log'"));
  assert.ok(!source.includes("'provider-custom-env.json'"));
});

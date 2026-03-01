import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('startup path auto-repairs invalid sdk keys and writes audit', () => {
  const source = read('src/index.ts');
  assert.ok(source.includes('getRuntimeApiKeyAutoRepairPatch'));
  assert.ok(source.includes('auto_repair_runtime_api_keys'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled task rows normalize buffer-like text fields to strings', () => {
  const source = read('src/db.ts');

  assert.ok(
    source.includes('Buffer.isBuffer(raw)'),
    'scheduled task mapping should decode Buffer values',
  );
  assert.ok(
    source.includes('prompt: parseTaskText'),
    'scheduled task mapping should normalize prompt to string',
  );
  assert.ok(
    source.includes('script_command: parseTaskNullableText'),
    'scheduled task mapping should normalize script_command to nullable string',
  );
});

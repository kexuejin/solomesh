import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled runtime fallback is not limited to status=error', () => {
  const source = read('src/task-scheduler.ts');
  assert.ok(source.includes('shouldRetryWithFallbackRuntime('));
  assert.ok(!source.includes("if (attemptOutput.status !== 'error') break;"));
});

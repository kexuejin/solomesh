import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled task closes session shortly after success output', () => {
  const source = read('src/task-scheduler.ts');
  assert.ok(source.includes('const SCHEDULED_TASK_RESULT_CLOSE_MS = 5_000;'));
  assert.ok(source.includes("if (streamedOutput.status === 'success')"));
  assert.ok(source.includes('resetIdleTimer(SCHEDULED_TASK_RESULT_CLOSE_MS);'));
});

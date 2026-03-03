import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled tasks use per-task operation permission mode instead of hardcoded bypass', () => {
  const source = read('src/task-scheduler.ts');
  assert.ok(
    source.includes('operationPermissionMode: task.operation_permission_mode'),
    'scheduled tasks should pass operation permission mode from task config',
  );
  assert.ok(
    !source.includes("operationPermissionMode: 'bypass'"),
    'scheduled tasks should not force bypass for every task',
  );
});

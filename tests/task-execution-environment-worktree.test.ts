import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('scheduled tasks support execution_environment worktree/local', () => {
  const scheduler = read('src/task-scheduler.ts');
  assert.ok(
    scheduler.includes('execution_environment'),
    'task scheduler should read execution_environment from task config',
  );
  assert.ok(
    scheduler.includes("['worktree', 'add', '--detach'"),
    'task scheduler should create a git worktree for worktree mode',
  );
  assert.ok(
    scheduler.includes("['worktree', 'remove', '--force'"),
    'task scheduler should cleanup git worktree after execution',
  );
});


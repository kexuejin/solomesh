import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('tasks route uses task_config and avoids legacy todo policy fields', () => {
  const source = read('src/routes/tasks.ts');

  assert.ok(source.includes('task_config'));
  assert.ok(source.includes('task_config: task_config ?? null'));
  assert.ok(!source.includes('todo_auto_create'));
  assert.ok(!source.includes('todo_daily_quota'));
});

test('task schemas define task_config and drop legacy todo policy fields', () => {
  const source = read('src/schemas.ts');

  assert.ok(source.includes('TaskConfigSchema'));
  assert.ok(source.includes('task_config: TaskConfigSchema'));
  assert.ok(!source.includes('todo_auto_create: z.boolean().optional()'));
  assert.ok(!source.includes('todo_daily_quota: z.number()'));
});

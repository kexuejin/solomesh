import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('tasks route uses workflow_rules and avoids legacy todo policy fields', () => {
  const source = read('src/routes/tasks.ts');

  assert.ok(source.includes('workflow_rules'));
  assert.ok(source.includes('workflow_rules: workflow_rules ?? null'));
  assert.ok(!source.includes('todo_auto_create'));
  assert.ok(!source.includes('todo_daily_quota'));
});

test('task schemas define workflow_rules and drop legacy todo policy fields', () => {
  const source = read('src/schemas.ts');

  assert.ok(source.includes('TaskWorkflowRulesSchema'));
  assert.ok(source.includes('workflow_rules: TaskWorkflowRulesSchema'));
  assert.ok(!source.includes('todo_auto_create: z.boolean().optional()'));
  assert.ok(!source.includes('todo_daily_quota: z.number()'));
});

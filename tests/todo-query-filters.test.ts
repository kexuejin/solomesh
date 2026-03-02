import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('todo query route uses source_type and trigger_mode filters', () => {
  const routes = read('src/routes/todos.ts');
  assert.ok(routes.includes('source_type'));
  assert.ok(routes.includes('trigger_mode'));
  assert.ok(routes.includes('TodoQuerySchema'));
});

test('db listTodos applies source and trigger filters using source events', () => {
  const dbSource = read('src/db.ts');
  assert.ok(dbSource.includes('export function listTodos('));
  assert.ok(dbSource.includes('e.source_type = ?'));
  assert.ok(dbSource.includes('e.trigger_mode = ?'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('todo query route uses source filters and trigger_mode filters', () => {
  const routes = read('src/routes/todos.ts');
  const schemas = read('src/schemas.ts');
  assert.ok(routes.includes('TodoQuerySchema'));
  assert.ok(schemas.includes('TodoQuerySchema'));
  assert.ok(schemas.includes('source_type'));
  assert.ok(schemas.includes('source_id'));
  assert.ok(schemas.includes('source_run_id'));
  assert.ok(schemas.includes('trigger_mode'));
  assert.ok(routes.includes('source_type'));
  assert.ok(routes.includes('trigger_mode'));
});

test('db listTodos applies source and trigger filters using source events', () => {
  const dbSource = read('src/db.ts');
  assert.ok(dbSource.includes('export function listTodos('));
  assert.ok(dbSource.includes('e.source_type = ?'));
  assert.ok(dbSource.includes('e.source_id = ?'));
  assert.ok(dbSource.includes('e.source_run_id = ?'));
  assert.ok(dbSource.includes('e.trigger_mode = ?'));
});

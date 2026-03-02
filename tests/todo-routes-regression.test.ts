import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web mounts todo routes', () => {
  const web = read('src/web.ts');
  assert.ok(web.includes("import todosRoutes from './routes/todos.js';"));
  assert.ok(web.includes("app.route('/api/todos', todosRoutes);"));
});

test('todo routes expose ingest/list/events endpoints', () => {
  const routes = read('src/routes/todos.ts');
  assert.ok(routes.includes("todosRoutes.post('/ingest'"));
  assert.ok(routes.includes("todosRoutes.post('/'"));
  assert.ok(routes.includes("todosRoutes.get('/'"));
  assert.ok(routes.includes("todosRoutes.get('/metrics'"));
  assert.ok(routes.includes("todosRoutes.get('/:id/events'"));
});

test('todo routes enforce source-based visibility and non-leaking not-found responses', () => {
  const routes = read('src/routes/todos.ts');
  assert.ok(routes.includes('canAccessTodoBySourceEvents'));
  assert.ok(routes.includes('resolveAccessibleWorkspaceFolders'));
  assert.ok(routes.includes('resolveAccessibleTaskIds'));
  assert.ok(routes.includes("event.source_type === 'automation'"));
  assert.ok(routes.includes("event.source_type === 'manual'"));
  assert.ok(routes.includes("extractDecisionItemIdFromEventEvidence"));
  assert.ok(routes.includes("return c.json({ error: 'Todo not found' }, 404);"));
});

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
  assert.ok(routes.includes("todosRoutes.get('/:id/events'"));
});

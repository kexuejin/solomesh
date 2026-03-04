import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web mounts radar routes', () => {
  const web = read('src/web.ts');
  assert.ok(web.includes("import radarRoutes from './routes/radar.js';"));
  assert.ok(web.includes("app.route('/api/radar', radarRoutes);"));
});

test('radar routes expose subscriptions and custom feed CRUD endpoints', () => {
  const routes = read('src/routes/radar.ts');
  assert.ok(routes.includes("radarRoutes.get('/subscriptions'"));
  assert.ok(routes.includes("radarRoutes.put('/subscriptions/templates/:id'"));
  assert.ok(routes.includes("radarRoutes.post('/subscriptions/feeds'"));
  assert.ok(routes.includes("radarRoutes.patch('/subscriptions/feeds/:id'"));
  assert.ok(routes.includes("radarRoutes.delete('/subscriptions/feeds/:id'"));
});

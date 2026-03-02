import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web mounts decision routes', () => {
  const web = read('src/web.ts');
  assert.ok(web.includes("import decisionItemsRoutes from './routes/decision-items.js';"));
  assert.ok(web.includes("app.route('/api/decision-items', decisionItemsRoutes);"));
});

test('decision routes expose list/ingest/accept/ignore endpoints', () => {
  const routes = read('src/routes/decision-items.ts');
  assert.ok(routes.includes("decisionItemsRoutes.get('/'"));
  assert.ok(routes.includes("decisionItemsRoutes.post('/ingest'"));
  assert.ok(routes.includes("decisionItemsRoutes.post('/:id/accept'"));
  assert.ok(routes.includes("decisionItemsRoutes.post('/:id/ignore'"));
  assert.ok(routes.includes('canAccessGroup'));
  assert.ok(routes.includes('getDecisionItemById'));
});

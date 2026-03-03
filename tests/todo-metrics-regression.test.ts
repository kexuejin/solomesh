import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('todo metrics route wires TodoMetricsQuerySchema and db aggregator', () => {
  const routes = read('src/routes/todos.ts');
  assert.ok(routes.includes('TodoMetricsQuerySchema'));
  assert.ok(routes.includes("todosRoutes.get('/metrics'"));
  assert.ok(routes.includes('getTodoIngestMetrics('));
});

test('todo metrics db aggregator groups by action and source type', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('export function getTodoIngestMetrics('));
  assert.ok(source.includes('GROUP BY action'));
  assert.ok(source.includes('GROUP BY source_type, action'));
  assert.ok(source.includes('create_rate'));
  assert.ok(source.includes('merge_rate'));
});

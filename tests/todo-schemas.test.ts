import test from 'node:test';
import assert from 'node:assert/strict';

import { TodoIngestSchema, TodoQuerySchema } from '../src/schemas.js';

test('TodoIngestSchema accepts required source fields', () => {
  const parsed = TodoIngestSchema.safeParse({
    title: 'Rotate API keys',
    source_type: 'automation',
    source_id: 'task:nightly-security',
    source_run_id: 'run-2026-03-02-01',
    trigger_mode: 'automation',
  });
  assert.equal(parsed.success, true);
});

test('TodoIngestSchema rejects payload without source_id', () => {
  const parsed = TodoIngestSchema.safeParse({
    title: 'Missing source id',
    source_type: 'workflow',
  });
  assert.equal(parsed.success, false);
});

test('TodoQuerySchema accepts query filters', () => {
  const parsed = TodoQuerySchema.safeParse({
    status: 'open',
    priority: 'high',
    source_type: 'workflow',
    source_id: 'workflow:competitor-watch:emit-todo',
    source_run_id: 'run-2026-03-02-0900',
    trigger_mode: 'manual',
    limit: '20',
    cursor: 'abc',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.limit, 20);
    assert.equal(parsed.data.source_id, 'workflow:competitor-watch:emit-todo');
    assert.equal(parsed.data.source_run_id, 'run-2026-03-02-0900');
  }
});

test('TodoQuerySchema rejects invalid limit', () => {
  const parsed = TodoQuerySchema.safeParse({
    limit: '0',
  });
  assert.equal(parsed.success, false);
});

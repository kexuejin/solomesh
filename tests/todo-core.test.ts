import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMergePatch, computeDedupeKey, mergePriority } from '../src/todo-core.ts';

test('computeDedupeKey prefers explicit dedupe_key', () => {
  const key = computeDedupeKey({
    title: 'Rotate API keys',
    source_type: 'manual',
    source_id: 'user:u1',
    dedupe_key: 'manual-key',
  });
  assert.equal(key, 'manual-key');
});

test('computeDedupeKey is stable for same normalized input', () => {
  const a = computeDedupeKey({
    title: '  Rotate API Keys ',
    description: 'Need to rotate production keys',
    source_type: 'workflow',
    source_id: 'wf:security',
  });
  const b = computeDedupeKey({
    title: 'rotate api keys',
    description: 'need to rotate production keys',
    source_type: 'workflow',
    source_id: 'wf:security',
  });
  assert.equal(a, b);
});

test('computeDedupeKey ignores source for cross-source merge', () => {
  const a = computeDedupeKey({
    title: 'Rotate API keys',
    description: 'Need to rotate production keys',
    source_type: 'workflow',
    source_id: 'wf:security',
  });
  const b = computeDedupeKey({
    title: 'Rotate API keys',
    description: 'Need to rotate production keys',
    source_type: 'automation',
    source_id: 'task:nightly',
  });
  assert.equal(a, b);
});

test('mergePriority only escalates priority', () => {
  assert.equal(mergePriority('high', 'low'), 'high');
  assert.equal(mergePriority('low', 'critical'), 'critical');
  assert.equal(mergePriority(null, undefined), null);
});

test('buildMergePatch increments count and updates last_seen_at', () => {
  const existing = {
    id: 'todo-1',
    title: 'Rotate API keys',
    description: null,
    status: 'open' as const,
    priority: 'low' as const,
    dedupe_key: 'k1',
    occurrence_count: 1,
    first_seen_at: '2026-03-01T00:00:00.000Z',
    last_seen_at: '2026-03-01T00:00:00.000Z',
    created_by: 'u1',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
  const patch = buildMergePatch(existing, { priority: 'high' }, '2026-03-02T00:00:00.000Z');
  assert.equal(patch.occurrence_count, 2);
  assert.equal(patch.last_seen_at, '2026-03-02T00:00:00.000Z');
  assert.equal(patch.priority, 'high');
});

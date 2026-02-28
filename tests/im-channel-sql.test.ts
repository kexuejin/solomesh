import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImJidSqlPredicate } from '../src/db.js';

test('buildImJidSqlPredicate uses known IM channel prefixes', () => {
  const result = buildImJidSqlPredicate('jid');
  assert.equal(result.sql, '(jid LIKE ? OR jid LIKE ?)');
  assert.deepEqual(result.params, ['feishu:%', 'telegram:%']);
});

test('buildImJidSqlPredicate defaults to jid column', () => {
  const result = buildImJidSqlPredicate();
  assert.equal(result.sql, '(jid LIKE ? OR jid LIKE ?)');
  assert.deepEqual(result.params, ['feishu:%', 'telegram:%']);
});

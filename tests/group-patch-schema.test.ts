import test from 'node:test';
import assert from 'node:assert/strict';

import { GroupPatchSchema } from '../src/schemas.ts';

test('group patch schema accepts host custom_cwd update payload', () => {
  const parsed = GroupPatchSchema.parse({
    custom_cwd: '/Users/example/projects/app',
  });
  assert.equal(parsed.custom_cwd, '/Users/example/projects/app');
});

test('group patch schema accepts clearing custom_cwd with null', () => {
  const parsed = GroupPatchSchema.parse({
    custom_cwd: null,
  });
  assert.equal(parsed.custom_cwd, null);
});

test('group patch schema rejects oversized custom_cwd', () => {
  const payload = { custom_cwd: `/${'a'.repeat(2100)}` };
  const result = GroupPatchSchema.safeParse(payload);
  assert.equal(result.success, false);
});

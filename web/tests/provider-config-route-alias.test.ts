import test from 'node:test';
import assert from 'node:assert/strict';

import { getRuntimeConfigEndpoint } from '../src/api/runtime-endpoints.ts';

test('runtime endpoint uses runtime route', () => {
  assert.equal(getRuntimeConfigEndpoint(), '/api/config/runtime');
});

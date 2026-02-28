import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_APP_NAME } from '../src/branding.js';

test('default app name is SoloMesh', () => {
  assert.equal(DEFAULT_APP_NAME, 'SoloMesh');
});


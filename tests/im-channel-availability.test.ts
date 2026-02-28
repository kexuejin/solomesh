import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImChannelAvailability,
  getConfiguredImChannelAvailability,
  registerImChannelAvailabilityResolver,
} from '../src/im-channel-availability.js';

test('buildImChannelAvailability uses resolver result per channel', () => {
  const result = buildImChannelAvailability({
    feishu: () => true,
    telegram: () => false,
  });
  assert.deepEqual(result, {
    feishu: true,
    telegram: false,
  });
});

test('buildImChannelAvailability falls back to false on resolver error', () => {
  const result = buildImChannelAvailability({
    feishu: () => {
      throw new Error('boom');
    },
    telegram: () => true,
  });
  assert.deepEqual(result, {
    feishu: false,
    telegram: true,
  });
});

test('registerImChannelAvailabilityResolver overrides configured availability', () => {
  const prevFeishu = registerImChannelAvailabilityResolver('feishu', () => false);
  const prevTelegram = registerImChannelAvailabilityResolver('telegram', () => true);
  assert.equal(typeof prevFeishu === 'function' || prevFeishu === null, true);
  assert.equal(typeof prevTelegram === 'function' || prevTelegram === null, true);

  const result = getConfiguredImChannelAvailability();
  assert.equal(result.feishu, false);
  assert.equal(result.telegram, true);
});

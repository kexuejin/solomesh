import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getImChannelConfigDescriptor,
  listImChannelConfigDescriptors,
} from '../src/im-channel-config-descriptor.js';

test('listImChannelConfigDescriptors returns feishu and telegram descriptors', () => {
  const descriptors = listImChannelConfigDescriptors();
  assert.equal(descriptors.length, 2);
  assert.deepEqual(
    descriptors.map((item) => item.channel),
    ['feishu', 'telegram'],
  );
  assert.deepEqual(
    descriptors.map((item) => item.routeSegment),
    ['feishu', 'telegram'],
  );
});

test('getImChannelConfigDescriptor exposes expected defaults per channel', () => {
  const feishu = getImChannelConfigDescriptor('feishu');
  assert.deepEqual(feishu.emptyUserPublicConfig, {
    appId: '',
    hasAppSecret: false,
    appSecretMasked: null,
    enabled: false,
    updatedAt: null,
  });

  const telegram = getImChannelConfigDescriptor('telegram');
  assert.deepEqual(telegram.emptyUserPublicConfig, {
    hasBotToken: false,
    botTokenMasked: null,
    enabled: false,
    updatedAt: null,
  });
});

test('connection test capabilities are exposed only for telegram descriptor', () => {
  const feishu = getImChannelConfigDescriptor('feishu');
  assert.equal(feishu.systemConnectionTest, undefined);
  assert.equal(feishu.userConnectionTest, undefined);

  const telegram = getImChannelConfigDescriptor('telegram');
  assert.equal(typeof telegram.systemConnectionTest, 'function');
  assert.equal(typeof telegram.userConnectionTest, 'function');
});

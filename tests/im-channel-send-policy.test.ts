import test from 'node:test';
import assert from 'node:assert/strict';

import { isImChannelSendAllowed } from '../src/im-channel-send-policy.ts';

test('isImChannelSendAllowed defaults to true when no policy is provided', () => {
  assert.equal(isImChannelSendAllowed('feishu', undefined), true);
  assert.equal(isImChannelSendAllowed('telegram', undefined), true);
});

test('isImChannelSendAllowed respects explicit channel policy', () => {
  const allowChannels = { feishu: false };
  assert.equal(isImChannelSendAllowed('feishu', { allowChannels }), false);
  assert.equal(isImChannelSendAllowed('telegram', { allowChannels }), true);
});

test('isImChannelSendAllowed allows explicit true and blocks explicit false', () => {
  const allowChannels = { feishu: true, telegram: false };
  assert.equal(isImChannelSendAllowed('feishu', { allowChannels }), true);
  assert.equal(isImChannelSendAllowed('telegram', { allowChannels }), false);
});

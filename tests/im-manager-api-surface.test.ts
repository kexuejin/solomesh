import test from 'node:test';
import assert from 'node:assert/strict';

import { imManager } from '../src/im-manager.ts';

test('imManager exposes channel-agnostic APIs only', () => {
  const genericMethods = [
    'connectUserChannel',
    'disconnectUserChannel',
    'isUserChannelConnected',
    'getUserChannelStatuses',
    'getAnyChannelStatuses',
    'sendImMessage',
    'setTyping',
    'syncUserChannelGroups',
    'syncChannelGroupsByAnyConnectedUser',
    'getConnectedChannels',
    'getConnectedUserIds',
    'disconnectAll',
  ] as const;

  for (const method of genericMethods) {
    assert.equal(typeof (imManager as Record<string, unknown>)[method], 'function');
  }

  const legacyMethods = [
    'connectUserFeishu',
    'connectUserTelegram',
    'disconnectUserFeishu',
    'disconnectUserTelegram',
    'sendFeishuMessage',
    'sendTelegramMessage',
    'setFeishuTyping',
    'syncFeishuGroups',
    'isFeishuConnected',
    'isTelegramConnected',
    'isAnyFeishuConnected',
    'isAnyTelegramConnected',
    'getFeishuConnection',
    'getTelegramConnection',
  ] as const;

  for (const method of legacyMethods) {
    assert.equal(method in imManager, false);
  }
});

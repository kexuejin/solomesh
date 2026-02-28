import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeSystemFeishuConfig,
  mergeSystemTelegramConfig,
  mergeUserFeishuConfig,
  mergeUserTelegramConfig,
} from '../src/im-channel-config-merge.js';

test('mergeSystemFeishuConfig applies appId/appSecret/enabled and clear flag', () => {
  const current = {
    appId: 'old-app',
    appSecret: 'old-secret',
    enabled: true,
  };

  assert.deepEqual(
    mergeSystemFeishuConfig(current, {
      appId: 'new-app',
      appSecret: 'new-secret',
      enabled: false,
    }),
    {
      appId: 'new-app',
      appSecret: 'new-secret',
      enabled: false,
    },
  );

  assert.deepEqual(
    mergeSystemFeishuConfig(current, {
      clearAppSecret: true,
    }),
    {
      appId: 'old-app',
      appSecret: '',
      enabled: true,
    },
  );
});

test('mergeSystemTelegramConfig applies botToken/enabled and clear flag', () => {
  const current = {
    botToken: 'old-token',
    enabled: true,
  };

  assert.deepEqual(
    mergeSystemTelegramConfig(current, {
      botToken: 'new-token',
      enabled: false,
    }),
    {
      botToken: 'new-token',
      enabled: false,
    },
  );

  assert.deepEqual(
    mergeSystemTelegramConfig(current, {
      clearBotToken: true,
    }),
    {
      botToken: '',
      enabled: true,
    },
  );
});

test('mergeUserFeishuConfig trims input and enables first-time credential setup', () => {
  assert.deepEqual(
    mergeUserFeishuConfig(null, {
      appId: '  app-1  ',
      appSecret: '  sec-1  ',
    }),
    {
      appId: 'app-1',
      appSecret: 'sec-1',
      enabled: true,
      updatedAt: null,
    },
  );

  assert.deepEqual(
    mergeUserFeishuConfig(
      {
        appId: 'old-app',
        appSecret: 'old-sec',
        enabled: true,
        updatedAt: null,
      },
      { clearAppSecret: true },
    ),
    {
      appId: 'old-app',
      appSecret: '',
      enabled: true,
      updatedAt: null,
    },
  );
});

test('mergeUserTelegramConfig trims token and enables first-time token setup', () => {
  assert.deepEqual(
    mergeUserTelegramConfig(null, {
      botToken: '  tg-1  ',
    }),
    {
      botToken: 'tg-1',
      enabled: true,
      updatedAt: null,
    },
  );

  assert.deepEqual(
    mergeUserTelegramConfig(
      {
        botToken: 'old-token',
        enabled: false,
        updatedAt: null,
      },
      { enabled: true },
    ),
    {
      botToken: 'old-token',
      enabled: true,
      updatedAt: null,
    },
  );
});

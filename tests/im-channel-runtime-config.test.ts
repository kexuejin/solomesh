import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGlobalImChannelConfigMap,
  buildUserImChannelConfigMap,
  registerImChannelGlobalConfigGetter,
  registerImChannelUserConfigGetter,
} from '../src/im-channel-runtime-config.js';

test('im channel runtime config registry supports overriding getters', () => {
  const prevUserFeishu = registerImChannelUserConfigGetter('feishu', () => ({
    appId: 'user-app',
    appSecret: 'user-sec',
    enabled: true,
  }));
  const prevUserTelegram = registerImChannelUserConfigGetter('telegram', () => ({
    botToken: 'user-tg',
    enabled: false,
  }));
  const prevGlobalFeishu = registerImChannelGlobalConfigGetter('feishu', () => ({
    source: 'runtime',
    config: { appId: 'global-app', appSecret: 'global-sec', enabled: true },
  }));
  const prevGlobalTelegram = registerImChannelGlobalConfigGetter('telegram', () => ({
    source: 'runtime',
    config: { botToken: 'global-tg', enabled: true },
  }));

  try {
    const userMap = buildUserImChannelConfigMap('u-1');
    assert.deepEqual(userMap, {
      feishu: { appId: 'user-app', appSecret: 'user-sec', enabled: true },
      telegram: { botToken: 'user-tg', enabled: false },
    });

    const globalMap = buildGlobalImChannelConfigMap();
    assert.deepEqual(globalMap, {
      feishu: {
        source: 'runtime',
        config: { appId: 'global-app', appSecret: 'global-sec', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'global-tg', enabled: true },
      },
    });
  } finally {
    if (prevUserFeishu) {
      registerImChannelUserConfigGetter('feishu', prevUserFeishu);
    }
    if (prevUserTelegram) {
      registerImChannelUserConfigGetter('telegram', prevUserTelegram);
    }
    if (prevGlobalFeishu) {
      registerImChannelGlobalConfigGetter('feishu', prevGlobalFeishu);
    }
    if (prevGlobalTelegram) {
      registerImChannelGlobalConfigGetter('telegram', prevGlobalTelegram);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAnyEffectiveImChannelConfig,
  hasEnabledGlobalImChannelConfig,
  registerEffectiveImChannelConfigNormalizer,
  resolveEffectiveImChannelConfigs,
  selectEffectiveImChannelConfig,
  type EffectiveImChannelConfigNormalizer,
} from '../src/im-channel-effective-config.js';

test('admin falls back to global channel config when user config missing', () => {
  const result = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {},
    globalConfigs: {
      feishu: {
        source: 'runtime',
        config: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'tg-1', enabled: true },
      },
    },
  });

  assert.deepEqual(result, {
    feishu: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
    telegram: { botToken: 'tg-1', enabled: true },
  });
});

test('member user never uses global channel fallback', () => {
  const result = resolveEffectiveImChannelConfigs({
    isAdmin: false,
    userConfigs: {},
    globalConfigs: {
      feishu: {
        source: 'runtime',
        config: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'tg-1', enabled: true },
      },
    },
  });

  assert.deepEqual(result, {
    feishu: null,
    telegram: null,
  });
});

test('user channel config has higher priority than global config', () => {
  const result = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {
      feishu: { appId: 'user-app', appSecret: 'user-sec', enabled: false },
      telegram: { botToken: 'user-tg', enabled: false },
    },
    globalConfigs: {
      feishu: {
        source: 'runtime',
        config: { appId: 'global-app', appSecret: 'global-sec', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'global-tg', enabled: true },
      },
    },
  });

  assert.deepEqual(result, {
    feishu: { appId: 'user-app', appSecret: 'user-sec', enabled: false },
    telegram: { botToken: 'user-tg', enabled: false },
  });
});

test('invalid user config falls back to global only for admin', () => {
  const result = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {
      feishu: { appId: '', appSecret: 'x', enabled: true },
      telegram: { botToken: '', enabled: true },
    },
    globalConfigs: {
      feishu: {
        source: 'runtime',
        config: { appId: 'global-app', appSecret: 'global-sec', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'global-tg', enabled: true },
      },
    },
  });

  assert.deepEqual(result, {
    feishu: { appId: 'global-app', appSecret: 'global-sec', enabled: true },
    telegram: { botToken: 'global-tg', enabled: true },
  });
});

test('selectEffectiveImChannelConfig resolves by channel key', () => {
  const configs = resolveEffectiveImChannelConfigs({
    isAdmin: true,
    userConfigs: {},
    globalConfigs: {
      feishu: {
        source: 'runtime',
        config: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
      },
      telegram: {
        source: 'runtime',
        config: { botToken: 'tg-1', enabled: true },
      },
    },
  });

  assert.deepEqual(selectEffectiveImChannelConfig(configs, 'feishu'), {
    appId: 'app-1',
    appSecret: 'sec-1',
    enabled: true,
  });
  assert.deepEqual(selectEffectiveImChannelConfig(configs, 'telegram'), {
    botToken: 'tg-1',
    enabled: true,
  });
  assert.equal(selectEffectiveImChannelConfig(configs, 'unknown-channel'), null);
});

test('registerEffectiveImChannelConfigNormalizer can override channel parser', () => {
  const customNormalizer: EffectiveImChannelConfigNormalizer<'telegram'> = () => ({
    botToken: 'custom-token',
    enabled: false,
  });
  const previous = registerEffectiveImChannelConfigNormalizer(
    'telegram',
    customNormalizer,
  );
  try {
    const configs = resolveEffectiveImChannelConfigs({
      isAdmin: false,
      userConfigs: { telegram: { botToken: 'ignored' } },
      globalConfigs: {},
    });
    assert.deepEqual(configs, {
      feishu: null,
      telegram: { botToken: 'custom-token', enabled: false },
    });
  } finally {
    if (previous) {
      registerEffectiveImChannelConfigNormalizer('telegram', previous);
    }
  }
});

test('hasAnyEffectiveImChannelConfig reports whether any channel config exists', () => {
  assert.equal(
    hasAnyEffectiveImChannelConfig({
      feishu: null,
      telegram: null,
    }),
    false,
  );
  assert.equal(
    hasAnyEffectiveImChannelConfig({
      feishu: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
      telegram: null,
    }),
    true,
  );
});

test('hasEnabledGlobalImChannelConfig checks global channel availability by channel', () => {
  const globalConfigs = {
    feishu: {
      source: 'runtime',
      config: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
    },
    telegram: {
      source: 'none',
      config: null,
    },
  };
  assert.equal(hasEnabledGlobalImChannelConfig(globalConfigs, 'feishu'), true);
  assert.equal(hasEnabledGlobalImChannelConfig(globalConfigs, 'telegram'), false);
});

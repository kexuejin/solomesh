import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGlobalReloadCandidateConfigs,
  registerGlobalReloadConfigParser,
  type GlobalReloadConfigParser,
} from '../src/im-channel-reload.js';

test('buildGlobalReloadCandidateConfigs accepts valid feishu config', () => {
  const result = buildGlobalReloadCandidateConfigs('feishu', {
    appId: 'app-1',
    appSecret: 'sec-1',
    enabled: true,
  });
  assert.deepEqual(result, {
    feishu: { appId: 'app-1', appSecret: 'sec-1', enabled: true },
    telegram: null,
  });
});

test('buildGlobalReloadCandidateConfigs accepts valid telegram config', () => {
  const result = buildGlobalReloadCandidateConfigs('telegram', {
    botToken: 'tg-1',
    enabled: false,
  });
  assert.deepEqual(result, {
    feishu: null,
    telegram: { botToken: 'tg-1', enabled: false },
  });
});

test('buildGlobalReloadCandidateConfigs returns null for invalid config payload', () => {
  assert.equal(
    buildGlobalReloadCandidateConfigs('feishu', { appId: 'app-1' }),
    null,
  );
  assert.equal(
    buildGlobalReloadCandidateConfigs('telegram', { botToken: '' }),
    null,
  );
});

test('buildGlobalReloadCandidateConfigs returns null for unknown channel', () => {
  const result = buildGlobalReloadCandidateConfigs(
    'unknown-channel' as any,
    { botToken: 'tg-1', enabled: true },
  );
  assert.equal(result, null);
});

test('registerGlobalReloadConfigParser can override parser behavior', () => {
  const customFeishuParser: GlobalReloadConfigParser<'feishu'> = () => ({
    appId: 'custom-app',
    appSecret: 'custom-sec',
    enabled: false,
  });
  const previous = registerGlobalReloadConfigParser('feishu', customFeishuParser);
  try {
    const result = buildGlobalReloadCandidateConfigs('feishu', { appId: 'ignored' });
    assert.deepEqual(result, {
      feishu: { appId: 'custom-app', appSecret: 'custom-sec', enabled: false },
      telegram: null,
    });
  } finally {
    if (previous) {
      registerGlobalReloadConfigParser('feishu', previous);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reloadGlobalImChannelBestEffort,
  reloadUserImChannelBestEffort,
} from '../src/im-channel-config-reload.js';

test('reloadGlobalImChannelBestEffort returns false when no reloader is registered', async () => {
  const result = await reloadGlobalImChannelBestEffort(
    null,
    'feishu',
    { appId: 'app-1' },
  );
  assert.equal(result, false);
});

test('reloadGlobalImChannelBestEffort calls global reloader and returns result', async () => {
  const calls: Array<{ channel: string; config: unknown }> = [];
  const result = await reloadGlobalImChannelBestEffort(
    {
      reloadGlobalIMConfig: async (channel, config) => {
        calls.push({ channel, config });
        return true;
      },
    },
    'telegram',
    { botToken: 'tg-1' },
  );
  assert.equal(result, true);
  assert.deepEqual(calls, [{ channel: 'telegram', config: { botToken: 'tg-1' } }]);
});

test('reloadGlobalImChannelBestEffort catches errors and returns false', async () => {
  const warnings: string[] = [];
  const result = await reloadGlobalImChannelBestEffort(
    {
      reloadGlobalIMConfig: async () => {
        throw new Error('boom');
      },
    },
    'feishu',
    { appId: 'app-1' },
    {
      warn: (_payload, message) => {
        warnings.push(message);
      },
    },
  );
  assert.equal(result, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], 'Failed to reload feishu connection');
});

test('reloadUserImChannelBestEffort noops when no reloader is registered', async () => {
  await reloadUserImChannelBestEffort(null, 'u-1', 'feishu');
});

test('reloadUserImChannelBestEffort calls user reloader and swallows errors', async () => {
  const calls: Array<{ userId: string; channel: string }> = [];
  const warnings: string[] = [];

  await reloadUserImChannelBestEffort(
    {
      reloadUserIMConfig: async (userId, channel) => {
        calls.push({ userId, channel });
        throw new Error('boom');
      },
    },
    'u-1',
    'telegram',
    {
      warn: (_payload, message) => {
        warnings.push(message);
      },
    },
  );

  assert.deepEqual(calls, [{ userId: 'u-1', channel: 'telegram' }]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], 'Failed to hot-reload user telegram connection');
});

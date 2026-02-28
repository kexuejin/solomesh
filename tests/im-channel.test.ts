import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseImChannelFromJid,
  stripImChannelPrefix,
} from '../src/im-channel.ts';

test('parseImChannelFromJid identifies known channels', () => {
  assert.equal(parseImChannelFromJid('feishu:oc_xxx'), 'feishu');
  assert.equal(parseImChannelFromJid('telegram:-100123'), 'telegram');
  assert.equal(parseImChannelFromJid('web:main'), null);
});

test('stripImChannelPrefix returns channel and chat id', () => {
  assert.deepEqual(
    stripImChannelPrefix('feishu:oc_xxx'),
    { channel: 'feishu', chatId: 'oc_xxx' },
  );
  assert.deepEqual(
    stripImChannelPrefix('telegram:-100123'),
    { channel: 'telegram', chatId: '-100123' },
  );
  assert.equal(stripImChannelPrefix('web:main'), null);
});


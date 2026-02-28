import test from 'node:test';
import assert from 'node:assert/strict';

import { ChannelSessionBindingUpsertSchema } from '../src/schemas.ts';

test('channel session binding schema accepts valid payload', () => {
  const payload = ChannelSessionBindingUpsertSchema.parse({
    chatJid: 'feishu:oc_xxx',
    targetFolder: 'flow-demo',
    enabled: true,
  });
  assert.equal(payload.chatJid, 'feishu:oc_xxx');
  assert.equal(payload.targetFolder, 'flow-demo');
  assert.equal(payload.enabled, true);
});

test('channel session binding schema rejects empty fields', () => {
  const result = ChannelSessionBindingUpsertSchema.safeParse({
    chatJid: '',
    targetFolder: '',
  });
  assert.equal(result.success, false);
});


import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMergedMessageQueryJids,
  type MessageQueryGroup,
} from '../src/group-message-merge.js';

const OWNER_ID = 'u-owner';

function makeGroup(overrides: Partial<MessageQueryGroup>): MessageQueryGroup {
  return {
    jid: 'web:default',
    name: 'Default',
    folder: 'flow-default',
    added_at: '2026-01-01T00:00:00.000Z',
    created_by: OWNER_ID,
    is_home: false,
    ...overrides,
  };
}

test('non-home workspace merges accessible IM siblings', () => {
  const target = makeGroup({
    jid: 'web:ws-1',
    folder: 'flow-1',
    is_home: false,
  });
  const im = makeGroup({
    jid: 'feishu:oc_1',
    folder: 'flow-1',
    is_home: false,
  });
  const siblingWeb = makeGroup({
    jid: 'web:ws-2',
    folder: 'flow-1',
    is_home: false,
  });

  const result = resolveMergedMessageQueryJids({
    target,
    viewer: { id: OWNER_ID, role: 'member' },
    siblings: [target, im, siblingWeb],
    canAccess: () => true,
  });

  assert.deepEqual(result, ['web:ws-1', 'feishu:oc_1']);
});

test('non-home workspace skips inaccessible IM siblings', () => {
  const target = makeGroup({
    jid: 'web:ws-1',
    folder: 'flow-1',
    is_home: false,
  });
  const im = makeGroup({
    jid: 'feishu:oc_1',
    folder: 'flow-1',
    is_home: false,
    created_by: 'u-other',
  });

  const result = resolveMergedMessageQueryJids({
    target,
    viewer: { id: OWNER_ID, role: 'member' },
    siblings: [target, im],
    canAccess: (group) => group.created_by === OWNER_ID,
  });

  assert.deepEqual(result, ['web:ws-1']);
});

test('home group keeps owner-only sibling merge rule', () => {
  const target = makeGroup({
    jid: 'web:main',
    folder: 'main',
    is_home: true,
    created_by: OWNER_ID,
  });
  const ownerIm = makeGroup({
    jid: 'feishu:owner',
    folder: 'main',
    is_home: false,
    created_by: OWNER_ID,
  });
  const otherIm = makeGroup({
    jid: 'feishu:other',
    folder: 'main',
    is_home: false,
    created_by: 'u-other',
  });

  const result = resolveMergedMessageQueryJids({
    target,
    viewer: { id: OWNER_ID, role: 'admin' },
    siblings: [target, ownerIm, otherIm],
    canAccess: () => true,
  });

  assert.deepEqual(result, ['web:main', 'feishu:owner']);
});

test('im chat does not merge into sibling chats', () => {
  const target = makeGroup({
    jid: 'feishu:oc_1',
    folder: 'flow-1',
    is_home: false,
  });
  const siblingWeb = makeGroup({
    jid: 'web:ws-1',
    folder: 'flow-1',
    is_home: false,
  });

  const result = resolveMergedMessageQueryJids({
    target,
    viewer: { id: OWNER_ID, role: 'member' },
    siblings: [target, siblingWeb],
    canAccess: () => true,
  });

  assert.deepEqual(result, ['feishu:oc_1']);
});

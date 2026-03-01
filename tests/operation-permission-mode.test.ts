import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeOperationPermissionMode,
  setChatRequestedOperationPermissionMode,
  getChatRequestedOperationPermissionMode,
  resolveOperationPermissionModeForRuntime,
  mapClaudePermissionMode,
} from '../src/operation-permission-mode.js';

test('normalizeOperationPermissionMode accepts known values only', () => {
  assert.equal(normalizeOperationPermissionMode('default'), 'default');
  assert.equal(normalizeOperationPermissionMode('bypass'), 'bypass');
  assert.equal(normalizeOperationPermissionMode('invalid'), undefined);
});

test('chat requested operation permission mode can be set and cleared', () => {
  const chatJid = `test:opm:${Date.now()}`;
  setChatRequestedOperationPermissionMode(chatJid, 'default');
  assert.equal(getChatRequestedOperationPermissionMode(chatJid), 'default');

  setChatRequestedOperationPermissionMode(chatJid, undefined);
  assert.equal(getChatRequestedOperationPermissionMode(chatJid), undefined);
});

test('runtime mode resolution keeps claude configurable and forces others to default', () => {
  assert.equal(resolveOperationPermissionModeForRuntime('claude', 'bypass'), 'bypass');
  assert.equal(resolveOperationPermissionModeForRuntime('claude', undefined), 'bypass');
  assert.equal(resolveOperationPermissionModeForRuntime('codex', 'bypass'), 'default');
  assert.equal(resolveOperationPermissionModeForRuntime('gemini', 'bypass'), 'default');
});

test('claude permission mode mapping is stable', () => {
  assert.equal(mapClaudePermissionMode('default'), 'default');
  assert.equal(mapClaudePermissionMode('bypass'), 'bypassPermissions');
});

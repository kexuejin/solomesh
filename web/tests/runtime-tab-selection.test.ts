import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRuntimeTabAfterConfigLoad } from '../src/components/settings/runtime-tab-selection.ts';
import type { AgentRuntimeId } from '../src/runtime-definitions.ts';

const runtimeIds: AgentRuntimeId[] = ['claude', 'codex', 'gemini'];

test('preserves current tab when preserveCurrentTab is true', () => {
  const selected = resolveRuntimeTabAfterConfigLoad({
    availableRuntimeIds: runtimeIds,
    savedRuntime: 'claude',
    currentTab: 'gemini',
    preserveCurrentTab: true,
  });

  assert.equal(selected, 'gemini');
});

test('falls back to saved runtime when current tab is unavailable', () => {
  const selected = resolveRuntimeTabAfterConfigLoad({
    availableRuntimeIds: ['claude', 'codex'],
    savedRuntime: 'codex',
    currentTab: 'gemini',
    preserveCurrentTab: true,
  });

  assert.equal(selected, 'codex');
});

test('uses saved runtime when preserveCurrentTab is false', () => {
  const selected = resolveRuntimeTabAfterConfigLoad({
    availableRuntimeIds: runtimeIds,
    savedRuntime: 'claude',
    currentTab: 'gemini',
    preserveCurrentTab: false,
  });

  assert.equal(selected, 'claude');
});

test('falls back to first available runtime when saved runtime is unavailable', () => {
  const selected = resolveRuntimeTabAfterConfigLoad({
    availableRuntimeIds: ['codex', 'gemini'],
    savedRuntime: 'claude',
    currentTab: 'claude',
    preserveCurrentTab: false,
  });

  assert.equal(selected, 'codex');
});

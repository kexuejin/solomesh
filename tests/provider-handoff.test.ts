import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderHandoffPrompt,
  resolveProviderHandoffTransition,
} from '../src/provider-handoff.ts';

test('resolves transition when directive switches provider', () => {
  const transition = resolveProviderHandoffTransition({
    directiveProvider: 'codex',
    persistedProvider: 'claude',
    defaultProvider: 'claude',
    pendingFromProvider: null,
    effectiveProvider: 'codex',
  });
  assert.deepEqual(transition, {
    fromProvider: 'claude',
    toProvider: 'codex',
  });
});

test('resolves transition from pending switch when directive is absent', () => {
  const transition = resolveProviderHandoffTransition({
    directiveProvider: null,
    persistedProvider: 'codex',
    defaultProvider: 'claude',
    pendingFromProvider: 'claude',
    effectiveProvider: 'codex',
  });
  assert.deepEqual(transition, {
    fromProvider: 'claude',
    toProvider: 'codex',
  });
});

test('does not resolve transition when provider is unchanged', () => {
  const transition = resolveProviderHandoffTransition({
    directiveProvider: 'claude',
    persistedProvider: 'claude',
    defaultProvider: 'claude',
    pendingFromProvider: null,
    effectiveProvider: 'claude',
  });
  assert.equal(transition, null);
});

test('builds handoff prompt with recent context and provider tags', () => {
  const prompt = buildProviderHandoffPrompt(
    { fromProvider: 'claude', toProvider: 'codex' },
    [
      {
        sender: 'u1',
        sender_name: 'Alice',
        content: 'Please keep architecture constraints.',
        timestamp: '2026-02-26T12:00:00.000Z',
        is_from_me: false,
      },
      {
        sender: 'solomesh-agent',
        sender_name: 'SoloMesh',
        content: 'Decision: repository pattern + service layer.',
        timestamp: '2026-02-26T12:01:00.000Z',
        is_from_me: true,
        provider: 'claude',
      },
    ],
  );

  assert.match(prompt, /from="claude" to="codex"/);
  assert.match(prompt, /assistant \[claude\] SoloMesh/);
  assert.match(prompt, /repository pattern/);
});

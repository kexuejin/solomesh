import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderHandoffPrompt,
  selectProviderHandoffContextMessages,
  resolveHandoffContextBeforeTimestamp,
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

test('builds handoff prompt with compact history summary', () => {
  const prompt = buildProviderHandoffPrompt(
    { fromProvider: 'claude', toProvider: 'codex' },
    [
      {
        sender: 'u1',
        sender_name: 'Alice',
        content: '我们先确认 runtime 切换后不要丢上一条结论',
        timestamp: '2026-02-26T12:00:00.000Z',
        is_from_me: false,
      },
      {
        sender: 'solomesh-agent',
        sender_name: 'SoloMesh',
        content: '结论：保留切换前后关键上下文，并过滤当前待处理消息。',
        timestamp: '2026-02-26T12:01:00.000Z',
        is_from_me: true,
        provider: 'claude',
      },
    ],
  );

  assert.match(prompt, /<history_summary>/);
  assert.match(prompt, /最近用户诉求/);
  assert.match(prompt, /最近助手结论/);
  assert.match(prompt, /不要丢上一条结论/);
  assert.match(prompt, /过滤当前待处理消息/);
});

test('uses first pending user message timestamp as handoff context boundary', () => {
  const before = resolveHandoffContextBeforeTimestamp(
    '2026-02-26T12:00:00.000Z',
    [
      { timestamp: '2026-02-26T12:03:00.000Z' },
      { timestamp: '2026-02-26T12:04:00.000Z' },
    ],
  );
  assert.equal(before, '2026-02-26T12:03:00.000Z');
});

test('keeps assistant reply that arrives after switch message by filtering pending ids', () => {
  const context = selectProviderHandoffContextMessages(
    [
      {
        id: 'assistant-before',
        sender: 'solomesh-agent',
        sender_name: 'SoloMesh',
        content: 'old assistant before switch',
        timestamp: '2026-02-26T12:01:00.000Z',
        is_from_me: true,
        provider: 'codex',
      },
      {
        id: 'pending-user-switch',
        sender: 'u1',
        sender_name: 'Alice',
        content: '@claude continue',
        timestamp: '2026-02-26T12:02:00.000Z',
        is_from_me: false,
      },
      {
        id: 'assistant-after',
        sender: 'solomesh-agent',
        sender_name: 'SoloMesh',
        content: 'codex final answer emitted during shutdown',
        timestamp: '2026-02-26T12:02:01.000Z',
        is_from_me: true,
        provider: 'codex',
      },
    ],
    ['pending-user-switch'],
    24,
  );

  assert.equal(context.some((m) => m.content.includes('@claude continue')), false);
  assert.equal(
    context.some((m) => m.content.includes('codex final answer emitted during shutdown')),
    true,
  );
});

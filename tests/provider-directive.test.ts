import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseProviderDirective,
  resolveProviderDirectiveMessages,
} from '../src/provider-directive.ts';

test('parses codex directive at message start', () => {
  const parsed = parseProviderDirective('@codex please review this patch');
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.hasDirective, true);
  assert.equal(parsed.contentForPrompt, 'please review this patch');
  assert.equal(parsed.isDirectiveOnly, false);
});

test('parses claude directive with punctuation', () => {
  const parsed = parseProviderDirective('  @claude: plan this task');
  assert.equal(parsed.provider, 'claude');
  assert.equal(parsed.hasDirective, true);
  assert.equal(parsed.contentForPrompt, 'plan this task');
  assert.equal(parsed.isDirectiveOnly, false);
});

test('ignores provider mention not at beginning', () => {
  const parsed = parseProviderDirective('can you ask @codex to check this?');
  assert.equal(parsed.provider, null);
  assert.equal(parsed.hasDirective, false);
  assert.equal(parsed.contentForPrompt, 'can you ask @codex to check this?');
  assert.equal(parsed.isDirectiveOnly, false);
});

test('directive-only message keeps empty prompt content', () => {
  const parsed = parseProviderDirective(' @codex ');
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.hasDirective, true);
  assert.equal(parsed.contentForPrompt, '');
  assert.equal(parsed.isDirectiveOnly, true);
});

test('last directive wins when multiple messages are pending', () => {
  const result = resolveProviderDirectiveMessages([
    {
      id: '1',
      chat_jid: 'web:main',
      sender: 'u1',
      sender_name: 'u1',
      content: '@claude first message',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '2',
      chat_jid: 'web:main',
      sender: 'u1',
      sender_name: 'u1',
      content: '@codex second message',
      timestamp: '2026-01-01T00:00:01.000Z',
    },
  ]);

  assert.equal(result.providerOverride, 'codex');
  assert.equal(result.hasDirective, true);
  assert.equal(result.hasPromptContent, true);
  assert.equal(result.messages[0]?.content, 'first message');
  assert.equal(result.messages[1]?.content, 'second message');
});

test('resolved messages detect no prompt content for directive-only batch', () => {
  const result = resolveProviderDirectiveMessages([
    {
      id: '1',
      chat_jid: 'web:main',
      sender: 'u1',
      sender_name: 'u1',
      content: '@claude',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  ]);

  assert.equal(result.providerOverride, 'claude');
  assert.equal(result.hasDirective, true);
  assert.equal(result.hasPromptContent, false);
  assert.equal(result.messages[0]?.content, '');
});

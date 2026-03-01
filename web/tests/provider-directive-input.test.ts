import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseProviderDirectiveInput,
  isProviderDirectiveOnly,
  getProviderMentionSuggestions,
} from '../src/lib/provider-directive.ts';

test('parses directive-only input for provider switch', () => {
  const parsed = parseProviderDirectiveInput('  @codex ');
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.hasDirective, true);
  assert.equal(parsed.contentForPrompt, '');
  assert.equal(parsed.isDirectiveOnly, true);
});

test('non-directive input is not provider-only switch', () => {
  assert.equal(isProviderDirectiveOnly('hello @codex'), false);
  assert.equal(isProviderDirectiveOnly('@claude plan this'), false);
});

test('mention suggestions exclude current provider', () => {
  assert.deepEqual(
    getProviderMentionSuggestions({
      query: '',
      currentProvider: 'claude',
    }),
    ['codex', 'gemini'],
  );
  assert.deepEqual(
    getProviderMentionSuggestions({
      query: 'co',
      currentProvider: 'codex',
    }),
    [],
  );
});

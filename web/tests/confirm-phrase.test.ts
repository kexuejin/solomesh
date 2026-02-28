import test from 'node:test';
import assert from 'node:assert/strict';

import { isConfirmPhraseMatched } from '../src/lib/confirm-phrase.ts';

test('confirm phrase should match when input equals required text', () => {
  assert.equal(isConfirmPhraseMatched('工作区A', '工作区A'), true);
});

test('confirm phrase should ignore leading/trailing spaces in input', () => {
  assert.equal(isConfirmPhraseMatched('工作区A', '  工作区A  '), true);
});

test('confirm phrase should reject empty or mismatched input', () => {
  assert.equal(isConfirmPhraseMatched('工作区A', ''), false);
  assert.equal(isConfirmPhraseMatched('工作区A', '工作区B'), false);
});

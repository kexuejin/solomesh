import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGeminiManualModelCatalog } from '../src/agent-providers.ts';

test('gemini manual catalog prefers highest >=3 major family in CLI-style manual order', () => {
  const catalog = buildGeminiManualModelCatalog([
    'gemini-2.5-pro-exp-0822',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-preview',
    'gemini-4.2-flash-preview',
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
    'gemini-3.1-pro-preview',
    'gemini-4.2-pro-preview',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
  ]);

  assert.deepEqual(catalog, [
    'gemini-4.2-pro-preview',
    'gemini-4.2-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ]);
});

test('gemini manual catalog keeps preferred default model when not in curated list', () => {
  const catalog = buildGeminiManualModelCatalog(
    ['gemini-2.0-flash', 'gemini-2.5-pro'],
    'gemini-2.0-flash',
  );

  assert.deepEqual(catalog, [
    'gemini-2.0-flash',
    'gemini-2.5-pro',
  ]);
});

test('gemini manual catalog falls back to source models when no curated ids exist', () => {
  const catalog = buildGeminiManualModelCatalog(['gemini-2.0-pro-exp']);
  assert.deepEqual(catalog, ['gemini-2.0-pro-exp']);
});

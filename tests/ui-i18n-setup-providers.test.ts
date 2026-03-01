import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const SETUP_PROVIDERS_LITERAL_GUARD = [
  'placeholder="https://your-relay.example.com/v1"',
  'placeholder="KEY"',
  'placeholder="value"',
  'placeholder="https://generativelanguage.googleapis.com"',
  'placeholder="https://api.openai.com/v1"',
  "placeholder={engineMode === 'gemini' ? 'gemini-2.5-pro' : 'gpt-5-codex'}",
] as const;

test('setup providers page uses i18n dictionary keys', () => {
  const source = read('web/src/pages/SetupProvidersPage.tsx');

  assert.ok(source.includes('useI18n'));
  assert.ok(source.includes("t('setupProviders.page.title')"));
  assert.ok(!/[一-龥]/.test(source));
});

test('setup providers dictionaries exist in zh and en', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes('setupProviders: {'));
  assert.ok(messages.includes("title: '系统接入初始化'"));
  assert.ok(messages.includes("title: 'System Integration Setup'"));
});

test('setup providers page avoids hardcoded runtime placeholders', () => {
  const source = read('web/src/pages/SetupProvidersPage.tsx');
  for (const literal of SETUP_PROVIDERS_LITERAL_GUARD) {
    assert.ok(!source.includes(literal), `SetupProvidersPage should not include literal: ${literal}`);
  }
});

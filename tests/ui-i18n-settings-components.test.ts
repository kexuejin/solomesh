import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/components/settings/FeishuConfigForm.tsx',
  'web/src/components/settings/TelegramConfigForm.tsx',
  'web/src/components/settings/SystemSettingsSection.tsx',
  'web/src/components/settings/RuntimeSection.tsx',
  'web/src/components/settings/SecuritySection.tsx',
  'web/src/components/settings/AboutSection.tsx',
  'web/src/components/settings/ChannelsSection.tsx',
  'web/src/components/settings/SettingsFeedback.tsx',
  'web/src/components/settings/AppearanceSection.tsx',
  'web/src/components/settings/ProfileSection.tsx',
  'web/src/components/settings/UserChannelsSection.tsx',
  'web/src/components/settings/WorkflowSection.tsx',
] as const;

const RUNTIME_LITERAL_GUARD = [
  'placeholder="https://your-relay.example.com/v1"',
  'placeholder="KEY"',
  'placeholder="value"',
  'placeholder="https://generativelanguage.googleapis.com"',
  'placeholder="https://api.openai.com/v1"',
  "placeholder={isGeminiRuntime ? 'gemini-2.5-pro' : 'gpt-5-codex'}",
] as const;

const SETTINGS_LITERAL_GUARD = [
  'placeholder="template-id"',
  '>Settings<',
] as const;

test('settings components use i18n keys instead of hardcoded Chinese copy', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('runtime section avoids hardcoded runtime placeholders and tab literals', () => {
  const source = read('web/src/components/settings/RuntimeSection.tsx');
  for (const literal of RUNTIME_LITERAL_GUARD) {
    assert.ok(!source.includes(literal), `RuntimeSection should not include literal: ${literal}`);
  }
  assert.ok(!/>\s*API Key\s*</.test(source), 'RuntimeSection should use i18n for API Key tab label');
});

test('settings workflow/nav avoid hardcoded labels', () => {
  for (const relPath of [
    'web/src/components/settings/WorkflowSection.tsx',
    'web/src/components/settings/SettingsNav.tsx',
  ] as const) {
    const source = read(relPath);
    for (const literal of SETTINGS_LITERAL_GUARD) {
      assert.ok(!source.includes(literal), `${relPath} should not include literal: ${literal}`);
    }
  }
});

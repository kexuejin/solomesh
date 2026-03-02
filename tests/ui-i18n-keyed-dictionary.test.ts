import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web i18n uses key-based dictionaries for zh/en', () => {
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(messages.includes('export const zhCN ='));
  assert.ok(messages.includes('export const en ='));
  assert.ok(messages.includes("export const MESSAGES ="));
  assert.ok(messages.includes("'zh-CN': zhCN"));
});

test('i18n provider detects system locale with english fallback', () => {
  const runtimeSource = read('web/src/i18n/runtime.ts');
  const i18nSource = read('web/src/i18n.tsx');

  assert.ok(runtimeSource.includes('navigator.languages'));
  assert.ok(runtimeSource.includes("return 'en'"));
  assert.ok(runtimeSource.includes('function normalizeUiLocale'));
  assert.ok(i18nSource.includes('detectUiLocale'));
});

test('navigation/settings consume translation keys instead of inline labels', () => {
  const navRail = read('web/src/components/layout/NavRail.tsx');
  const settingsNav = read('web/src/components/settings/SettingsNav.tsx');

  assert.ok(navRail.includes("labelKey: 'nav.workspace'"));
  assert.ok(settingsNav.includes("labelKey: 'settings.tabs.runtime'"));
});

test('workflow directive suggestions use translation keys', () => {
  const source = read('web/src/lib/workflow-directive.ts');

  assert.ok(source.includes('descriptionKey'));
  assert.ok(source.includes("chat.workflowDirective.templates.analysisHeavy"));
  assert.ok(source.includes("chat.workflowDirective.automations.competitorWatch"));
  assert.ok(!/[一-龥]/.test(source), 'workflow-directive should not contain hardcoded Chinese literals');
});

test('system chat parser uses i18n keys for user-visible text', () => {
  const source = read('web/src/lib/system-message.ts');

  assert.ok(source.includes("chat.system.contextReset"));
  assert.ok(source.includes('localizeSystemMessage'));
  assert.ok(!/[一-龥]/.test(source), 'system-message should not contain hardcoded Chinese literals');
});

test('workflow template editor uses structured error codes (no hardcoded Chinese)', () => {
  const source = read('web/src/lib/workflow-template-editor.ts');

  assert.ok(source.includes('WorkflowTemplateEditorError'));
  assert.ok(source.includes("'invalid_stage_id'"));
  assert.ok(source.includes("'json_invalid'"));
  assert.ok(!/[一-龥]/.test(source), 'workflow-template-editor should not contain hardcoded Chinese literals');
});

test('skills store uses localized fallback messages', () => {
  const source = read('web/src/stores/skills.ts');

  assert.ok(source.includes("skills.store.installFailed"));
  assert.ok(source.includes("skills.store.syncFailed"));
  assert.ok(source.includes('translateLocaleMessage'));
  assert.ok(source.includes('getStoreMessage'));
  assert.ok(!/[一-龥]/.test(source), 'skills store should not contain hardcoded Chinese literals');
});

test('chat store streaming labels use localized keys', () => {
  const source = read('web/src/stores/chat.ts');

  assert.ok(source.includes("chat.store.stream.skillLabel"));
  assert.ok(source.includes("chat.store.stream.hookStarted"));
  assert.ok(source.includes('translateLocaleMessage'));
  assert.ok(source.includes('chatStoreText'));
  assert.ok(!source.includes('`技能 '), 'chat store should not hardcode Chinese skill labels in templates');
  assert.ok(!source.includes('`工具 '), 'chat store should not hardcode Chinese tool labels in templates');
  assert.ok(!source.includes('`状态: '), 'chat store should not hardcode Chinese status labels in templates');
});

test('non-react i18n consumers reuse runtime locale/message helpers', () => {
  const apiErrorUtils = read('web/src/api/error-utils.ts');
  const presets = read('web/src/components/tasks/automation-presets.ts');
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(apiErrorUtils.includes('translateLocaleMessage'));
  assert.ok(!apiErrorUtils.includes('solomesh.ui.locale'));
  assert.ok(presets.includes('getAutomationTemplates'));
  assert.ok(presets.includes('getSchedulePresets'));
  assert.ok(presets.includes("tasks.templates.dailyBrief.name"));
  assert.ok(presets.includes("tasks.presets.q10m.label"));
  assert.ok(messages.includes('tasks: {'));
  assert.ok(messages.includes('templates: {'));
  assert.ok(messages.includes('presets: {'));
  assert.ok(messages.includes("every: 'Every {{count}} {{unit}}'"));
  assert.ok(!presets.includes('solomesh.ui.locale'));
});

test('store fallback errors use translation keys', () => {
  const containerEnvStore = read('web/src/stores/container-env.ts');
  const fileStore = read('web/src/stores/files.ts');
  const mcpStore = read('web/src/stores/mcp-servers.ts');
  const usersStore = read('web/src/stores/users.ts');
  const tasksStore = read('web/src/stores/tasks.ts');
  const groupsStore = read('web/src/stores/groups.ts');
  const monitorStore = read('web/src/stores/monitor.ts');
  const chatStore = read('web/src/stores/chat.ts');
  const storeError = read('web/src/stores/error-message.ts');
  const libError = read('web/src/lib/error-message.ts');
  const settingsTypes = read('web/src/components/settings/types.ts');
  const apiErrorUtils = read('web/src/api/error-utils.ts');
  const messages = read('web/src/i18n/messages.ts');

  assert.ok(containerEnvStore.includes("chat.containerEnv.errors.loadConfigFailed"));
  assert.ok(containerEnvStore.includes('translateLocaleMessage'));
  assert.ok(containerEnvStore.includes('extractStoreErrorMessage'));
  assert.ok(!containerEnvStore.includes('Failed to load config'));
  assert.ok(!containerEnvStore.includes('Failed to save config'));

  assert.ok(fileStore.includes("chat.filePanel.errors.loadFilesFailed"));
  assert.ok(fileStore.includes('translateLocaleMessage'));
  assert.ok(fileStore.includes('extractStoreErrorMessage'));
  assert.ok(!fileStore.includes("?: 'Failed to load files'"));
  assert.ok(!fileStore.includes("?: 'Failed to upload files'"));
  assert.ok(!fileStore.includes("?: 'Failed to delete file'"));
  assert.ok(!fileStore.includes("?: 'Failed to create directory'"));
  assert.ok(!fileStore.includes("?: 'Failed to read file'"));
  assert.ok(!fileStore.includes("?: 'Failed to save file'"));

  assert.ok(mcpStore.includes("mcp.store.syncFailed"));
  assert.ok(mcpStore.includes('translateLocaleMessage'));
  assert.ok(mcpStore.includes('extractStoreErrorMessage'));
  assert.ok(!mcpStore.includes('Sync failed. Please try again later.'));

  assert.ok(usersStore.includes("users.store.fetchUsersFailed"));
  assert.ok(usersStore.includes('translateLocaleMessage'));
  assert.ok(usersStore.includes('extractStoreErrorMessage'));
  assert.ok(!usersStore.includes('Failed to fetch users'));
  assert.ok(!usersStore.includes('Failed to fetch invites'));
  assert.ok(!usersStore.includes('Failed to fetch audit logs'));

  assert.ok(tasksStore.includes("tasks.store.loadFailed"));
  assert.ok(tasksStore.includes('translateLocaleMessage'));
  assert.ok(tasksStore.includes('extractStoreErrorMessage'));
  assert.ok(!tasksStore.includes('String(err)'));

  assert.ok(groupsStore.includes("groups.store.loadFailed"));
  assert.ok(groupsStore.includes('translateLocaleMessage'));
  assert.ok(groupsStore.includes('extractStoreErrorMessage'));
  assert.ok(!groupsStore.includes('String(err)'));

  assert.ok(monitorStore.includes("monitor.store.loadStatusFailed"));
  assert.ok(monitorStore.includes('translateLocaleMessage'));
  assert.ok(monitorStore.includes('extractStoreErrorMessage'));
  assert.ok(!monitorStore.includes('String(err)'));

  assert.ok(chatStore.includes("chat.store.errors.loadGroupsFailed"));
  assert.ok(chatStore.includes('chatStoreError'));
  assert.ok(chatStore.includes('extractStoreErrorMessage'));
  assert.ok(!chatStore.includes('String(err)'));

  assert.ok(storeError.includes('export function extractStoreErrorMessage'));
  assert.ok(storeError.includes("from '../lib/error-message'"));
  assert.ok(libError.includes('export function extractErrorMessage'));
  assert.ok(settingsTypes.includes('extractErrorMessage'));
  assert.ok(apiErrorUtils.includes('extractErrorMessage'));

  assert.ok(messages.includes('containerEnv: {'));
  assert.ok(messages.includes('loadConfigFailed'));
  assert.ok(messages.includes('filePanel: {'));
  assert.ok(messages.includes('uploadFilesFailed'));
  assert.ok(messages.includes('mcp: {'));
  assert.ok(messages.includes('users: {'));
  assert.ok(messages.includes('users.store.fetchUsersFailed') || messages.includes('fetchUsersFailed'));
  assert.ok(messages.includes('tasks: {'));
  assert.ok(messages.includes('monitor: {'));
  assert.ok(messages.includes('groups: {'));
  assert.ok(messages.includes('chat.store.errors.loadGroupsFailed') || messages.includes('loadGroupsFailed'));
});
